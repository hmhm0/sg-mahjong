const http = require('http');
const { WebSocketServer } = require('ws');
const { buildInitialMultiplayerState } = require('./roundSetup.cjs');
const { isChipMatchOverState, createMatchReadyState, areAllMatchSeatsReady } = require('./matchLifecycle.cjs');
const { createTsRuntime } = require('./ts-runtime.cjs');
const { RoomPersistence } = require('./roomPersistence.cjs');
const { createOperations } = require('./operations.cjs');
const {
  ConnectionCounter,
  FixedWindowLimiter,
  createReconnectToken,
  createRoomCode,
  getClientIp,
  normalizeRoomCode,
  readPositiveInteger,
  tokenMatches,
} = require('./security.cjs');
const path = require('path');

const PORT = readPositiveInteger(process.env.PORT, 3002);
const MAX_PAYLOAD_BYTES = readPositiveInteger(process.env.MAX_PAYLOAD_BYTES, 64 * 1024);
const MAX_BUFFERED_BYTES = readPositiveInteger(process.env.MAX_BUFFERED_BYTES, 1024 * 1024);
const HEARTBEAT_INTERVAL_MS = readPositiveInteger(process.env.HEARTBEAT_INTERVAL_MS, 30 * 1000);
const EMPTY_ROOM_TIMEOUT_MS = readPositiveInteger(process.env.EMPTY_ROOM_TIMEOUT_MS, 10 * 60 * 1000);
const HOST_DISCONNECT_TIMEOUT_MS = readPositiveInteger(process.env.HOST_DISCONNECT_TIMEOUT_MS, 2 * 60 * 1000);
const PLAYER_DISCONNECT_TIMEOUT_MS = readPositiveInteger(process.env.PLAYER_DISCONNECT_TIMEOUT_MS, 2 * 60 * 1000);
const RESTART_RECOVERY_TIMEOUT_MS = readPositiveInteger(process.env.RESTART_RECOVERY_TIMEOUT_MS, 10 * 60 * 1000);
const MAX_CONNECTIONS_PER_IP = readPositiveInteger(process.env.MAX_CONNECTIONS_PER_IP, 32);
const MAX_CONNECTIONS = readPositiveInteger(process.env.MAX_CONNECTIONS, 250);
const MESSAGE_LIMIT = readPositiveInteger(process.env.MESSAGE_LIMIT, 120);
const MESSAGE_WINDOW_MS = readPositiveInteger(process.env.MESSAGE_WINDOW_MS, 10 * 1000);
const ROOM_CREATE_LIMIT = readPositiveInteger(process.env.ROOM_CREATE_LIMIT, 10);
const ROOM_CREATE_WINDOW_MS = readPositiveInteger(process.env.ROOM_CREATE_WINDOW_MS, 60 * 1000);
const MAX_ROOMS = readPositiveInteger(process.env.MAX_ROOMS, 50);
const ROOM_STATE_FILE = process.env.ROOM_STATE_FILE || path.resolve(__dirname, '.data/rooms.json');
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));
const GAME_STORE_ENTRY = path.resolve(__dirname, '../src/store/gameStore.ts');
const rooms = {}; // code -> canonical multiplayer room state
const operations = createOperations();
const persistence = new RoomPersistence(ROOM_STATE_FILE);
const connectionCounter = new ConnectionCounter(MAX_CONNECTIONS_PER_IP);
const messageLimiter = new FixedWindowLimiter({ limit: MESSAGE_LIMIT, windowMs: MESSAGE_WINDOW_MS });
const roomCreateLimiter = new FixedWindowLimiter({ limit: ROOM_CREATE_LIMIT, windowMs: ROOM_CREATE_WINDOW_MS });
const sharedRuntime = createTsRuntime();
const gameStoreExports = sharedRuntime.load(GAME_STORE_ENTRY);

if (typeof gameStoreExports.createGameStore !== 'function') {
  throw new TypeError('createGameStore is not exported by src/store/gameStore.ts');
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const body = JSON.stringify(operations.snapshot(rooms, wss));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  if (req.url === '/metrics') {
    const body = operations.prometheus(rooms, wss);
    res.writeHead(200, {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_PAYLOAD_BYTES,
  perMessageDeflate: false,
});

function clampInteger(value, min, max, fallback) {
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}

function sanitizeName(value, fallback) {
  const name = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 15)
    : '';
  return name || fallback;
}

function sanitizeConfig(input) {
  const config = input && typeof input === 'object' ? input : {};
  const allowedFeiCounts = new Set([0, 4, 8, 12, 16, 20]);
  const allowedPayoutTables = new Set(['none', '010_020', '030_060', '1_2']);
  const payoutTable = allowedPayoutTables.has(config.payoutTable) ? config.payoutTable : 'none';
  const shooterEnabled = Boolean(config.shooterEnabled);
  return {
    taiThreshold: clampInteger(config.taiThreshold, 0, 18, 4),
    unlimitedTai: Boolean(config.unlimitedTai),
    feiCount: allowedFeiCounts.has(config.feiCount) ? config.feiCount : 4,
    payoutTable,
    startingChips: Number.isFinite(config.startingChips)
      ? clampInteger(config.startingChips, 0, 1000000000, 0)
      : null,
    shooterEnabled,
    maxTai: clampInteger(config.maxTai, 1, 18, 10),
    specialTaiCapEnabled: Boolean(config.specialTaiCapEnabled),
    specialTaiCap: clampInteger(config.specialTaiCap, 1, 18, 18),
    economyEnabled: Boolean(config.economyEnabled) && payoutTable !== 'none',
    chipSettlementMode: shooterEnabled ? 'shooter' : 'default',
  };
}

function isValidActionMessage(msg) {
  if (!msg || typeof msg.actionType !== 'string') return false;
  const allowed = new Set([
    'discard',
    'self_draw_win',
    'pass_self_draw',
    'win',
    'kong',
    'pung',
    'chi',
    'pass_claim',
    'self_kong',
    'concealed_kong',
    'pass_self_kong',
  ]);
  if (!allowed.has(msg.actionType)) return false;
  if (msg.clientActionId !== undefined && (
    typeof msg.clientActionId !== 'string' ||
    msg.clientActionId.length < 1 ||
    msg.clientActionId.length > 64
  )) {
    return false;
  }
  const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
  for (const key of ['tileIndex', 'meldIndex', 'handTileIndex']) {
    if (data[key] !== undefined && (!Number.isInteger(data[key]) || data[key] < -1 || data[key] > 200)) {
      return false;
    }
  }
  if (data.chiTiles !== undefined && (!Array.isArray(data.chiTiles) || data.chiTiles.length !== 2)) {
    return false;
  }
  return true;
}

function safeSend(ws, serializedMessage) {
  if (!ws || ws.readyState !== 1) return false;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    operations.counters.backpressureDisconnects++;
    try {
      ws.close(1013, 'Client connection is too slow');
    } catch {}
    return false;
  }
  try {
    ws.send(serializedMessage, error => {
      if (error) {
        try {
          ws.terminate();
        } catch {}
      }
    });
    operations.counters.bytesSent += Buffer.byteLength(serializedMessage);
    return true;
  } catch {
    return false;
  }
}

function broadcast(roomCode, message, exclude = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const msg = JSON.stringify(message);
  operations.counters.broadcasts++;
  for (const ws of [room.host, ...room.players]) {
    if (ws && ws !== exclude) safeSend(ws, msg);
  }
}

function send(ws, message) {
  return safeSend(ws, JSON.stringify(message));
}

function serializeState(state) {
  const payload = {};
  for (const key of Object.keys(state || {})) {
    const value = state[key];
    if (key === 'debugLogs') {
      payload.debugLogs = [];
    } else if (typeof value !== 'function') {
      payload[key] = value;
    }
  }
  return payload;
}

function persistRooms() {
  try {
    persistence.schedule(rooms);
  } catch (error) {
    console.error('Failed to schedule room persistence:', error);
  }
}

function clearEmptyRoomTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.emptyRoomTimer) return;
  clearTimeout(room.emptyRoomTimer);
  room.emptyRoomTimer = null;
}

function clearHostDisconnectTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.hostDisconnectTimer) return;
  clearTimeout(room.hostDisconnectTimer);
  room.hostDisconnectTimer = null;
}

function clearStartStateTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.startStateTimer) return;
  clearTimeout(room.startStateTimer);
  room.startStateTimer = null;
}

function clearBotActionTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.botActionTimer) return;
  clearTimeout(room.botActionTimer);
  room.botActionTimer = null;
}

function clearRematchCountdownTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.rematchCountdownTimer) return;
  clearTimeout(room.rematchCountdownTimer);
  room.rematchCountdownTimer = null;
}

function clearRecoveryTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.recoveryTimer) return;
  clearTimeout(room.recoveryTimer);
  room.recoveryTimer = null;
}

function clearStateSyncTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.stateSyncTimer) return;
  clearTimeout(room.stateSyncTimer);
  room.stateSyncTimer = null;
}

function clearSeatDisconnectTimer(roomCode, seatIndex) {
  const room = rooms[roomCode];
  const timer = room?.seatDisconnectTimers?.[seatIndex];
  if (!timer) return;
  clearTimeout(timer);
  room.seatDisconnectTimers[seatIndex] = null;
}

function clearSeatDisconnectTimers(roomCode) {
  for (let seatIndex = 0; seatIndex < 3; seatIndex++) {
    clearSeatDisconnectTimer(roomCode, seatIndex);
  }
}

function destroyRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearEmptyRoomTimer(roomCode);
  clearHostDisconnectTimer(roomCode);
  clearStartStateTimer(roomCode);
  clearBotActionTimer(roomCode);
  clearRematchCountdownTimer(roomCode);
  clearRecoveryTimer(roomCode);
  clearStateSyncTimer(roomCode);
  clearSeatDisconnectTimers(roomCode);
  if (typeof room.engineStateUnsubscribe === 'function') {
    try {
      room.engineStateUnsubscribe();
    } catch {}
    room.engineStateUnsubscribe = null;
  }
  delete rooms[roomCode];
  operations.counters.roomsDestroyed++;
  persistRooms();
}

function releaseLobbySeat(roomCode, seatIndex) {
  const room = rooms[roomCode];
  if (!room || room.started || seatIndex < 0 || seatIndex > 2) return false;
  clearSeatDisconnectTimer(roomCode, seatIndex);
  room.players[seatIndex] = null;
  room.humanSeats[seatIndex + 1] = false;
  room.ready[seatIndex + 1] = false;
  room.names[seatIndex + 1] = null;
  room.seatTokens[seatIndex + 1] = createReconnectToken();
  room.paused = false;
  room.pauseReason = null;
  broadcast(roomCode, { type: 'player_left', playerIndex: seatIndex + 1 });
  broadcastRoomSnapshot(roomCode);
  scheduleEmptyRoomTimer(roomCode);
  persistRooms();
  return true;
}

function scheduleSeatDisconnectTimer(roomCode, seatIndex) {
  const room = rooms[roomCode];
  if (!room || seatIndex < 0 || seatIndex > 2) return;
  clearSeatDisconnectTimer(roomCode, seatIndex);
  room.seatDisconnectTimers[seatIndex] = setTimeout(() => {
    const current = rooms[roomCode];
    if (!current || current.players[seatIndex]) return;
    if (!current.started) {
      releaseLobbySeat(roomCode, seatIndex);
      return;
    }
    broadcast(roomCode, {
      type: 'room_closed',
      reason: 'player_disconnect_timeout',
      playerIndex: seatIndex + 1,
    });
    destroyRoom(roomCode);
  }, PLAYER_DISCONNECT_TIMEOUT_MS);
}

function scheduleEmptyRoomTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.started) return;
  if (room.players.some(p => p !== null)) return;
  clearEmptyRoomTimer(roomCode);
  room.emptyRoomTimer = setTimeout(() => {
    const current = rooms[roomCode];
    if (!current || current.started || current.players.some(p => p !== null)) return;
    broadcast(roomCode, { type: 'room_closed', reason: 'empty_timeout' });
    destroyRoom(roomCode);
  }, EMPTY_ROOM_TIMEOUT_MS);
}

function sendRoomSnapshot(roomCode, ws, playerIndex) {
  const room = rooms[roomCode];
  if (!room || !ws || ws.readyState !== 1) return;
  send(ws, {
    type: 'room_snapshot',
    code: roomCode,
    playerIndex,
    started: room.started,
    paused: Boolean(room.paused),
    pauseReason: room.pauseReason || null,
    ready: [...room.ready],
    names: [...room.names],
    matchReady: Array.isArray(room.matchReady) ? [...room.matchReady] : null,
    rematchCountdown: room.rematchCountdown ?? null,
  });
}

function broadcastRoomSnapshot(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const payload = {
    type: 'room_snapshot',
    code: roomCode,
    started: room.started,
    paused: Boolean(room.paused),
    pauseReason: room.pauseReason || null,
    ready: [...room.ready],
    names: [...room.names],
    matchReady: Array.isArray(room.matchReady) ? [...room.matchReady] : null,
    rematchCountdown: room.rematchCountdown ?? null,
  };
  broadcast(roomCode, payload);
}

function broadcastRoomPaused(roomCode, reason) {
  broadcast(roomCode, { type: 'room_paused', reason });
  broadcastRoomSnapshot(roomCode);
}

function scheduleHostDisconnectTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearHostDisconnectTimer(roomCode);
  room.hostDisconnectTimer = setTimeout(() => {
    const current = rooms[roomCode];
    if (!current || current.host) return;
    broadcast(roomCode, { type: 'room_closed', reason: 'host_disconnect_timeout' });
    destroyRoom(roomCode);
  }, HOST_DISCONNECT_TIMEOUT_MS);
}

function broadcastInitialState(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.state) return;
  clearStartStateTimer(roomCode);
  room.started = true;
  room.paused = false;
  room.pauseReason = null;
  room.ready = [false, false, false, false];
  broadcastStateUpdate(roomCode, { full: true });
  scheduleBotAction(roomCode);
}

function createStateUpdatePayload(room, full) {
  room.stateRevision = (room.stateRevision || 0) + 1;
  const actionAcks = Array.isArray(room.pendingActionAcks) ? room.pendingActionAcks.splice(0) : [];
  if (full) {
    room.lastBroadcastMoveCount = room.state?.moveHistory?.length || 0;
    return {
      type: 'state_update',
      revision: room.stateRevision,
      full: true,
      state: room.state,
      actionAcks,
    };
  }

  const state = { ...room.state };
  const moveHistory = Array.isArray(state.moveHistory) ? state.moveHistory : [];
  delete state.debugLogs;
  delete state.moveHistory;

  const resetMoveHistory = moveHistory.length < (room.lastBroadcastMoveCount || 0);
  const moveHistoryStart = resetMoveHistory ? 0 : (room.lastBroadcastMoveCount || 0);
  const moveHistoryAppend = moveHistory.slice(moveHistoryStart);
  room.lastBroadcastMoveCount = moveHistory.length;

  return {
    type: 'state_update',
    revision: room.stateRevision,
    full: false,
    state,
    resetMoveHistory,
    moveHistoryStart,
    moveHistoryAppend,
    actionAcks,
  };
}

function broadcastStateUpdate(roomCode, { full = false } = {}) {
  const room = rooms[roomCode];
  if (!room?.state) return;
  broadcast(roomCode, createStateUpdatePayload(room, full));
}

function sendFullState(roomCode, ws) {
  const room = rooms[roomCode];
  if (!room?.state) return;
  room.lastBroadcastMoveCount = room.state.moveHistory?.length || 0;
  send(ws, {
    type: 'state_update',
    revision: room.stateRevision || 0,
    full: true,
    state: room.state,
  });
}

function scheduleRoomStateSync(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.stateSyncTimer) return;
  room.stateSyncTimer = setTimeout(() => {
    const current = rooms[roomCode];
    if (!current) return;
    current.stateSyncTimer = null;
    syncRoomStateFromEngine(roomCode);
  }, 25);
}

function ensureRoomEngine(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;
  if (room.engine) return room.engine;
  room.engine = gameStoreExports.createGameStore();
  if (room.state) {
    room.syncSuspended = true;
    try {
      room.engine.setState(room.state);
    } finally {
      room.syncSuspended = false;
    }
  }
  if (!room.engineStateUnsubscribe && typeof room.engine.subscribe === 'function') {
    room.engineStateUnsubscribe = room.engine.subscribe(() => {
      const activeRoomCode = room.code || roomCode;
      const current = rooms[activeRoomCode];
      if (!current || current.engine !== room.engine || current.syncSuspended) return;
      scheduleRoomStateSync(activeRoomCode);
    });
  }
  return room.engine;
}

function areAllHumanSeatsConnected(room) {
  if (!room?.host || !Array.isArray(room.humanSeats)) return false;
  for (let playerIndex = 1; playerIndex < 4; playerIndex++) {
    if (room.humanSeats[playerIndex] && !room.players[playerIndex - 1]) return false;
  }
  return true;
}

function resumeRoomIfComplete(roomCode) {
  const room = rooms[roomCode];
  if (!room || !areAllHumanSeatsConnected(room)) return false;
  clearRecoveryTimer(roomCode);
  clearHostDisconnectTimer(roomCode);
  room.paused = false;
  room.pauseReason = null;
  if (room.state) {
    room.state.roomPaused = false;
    room.state.roomPauseReason = null;
  }
  if (room.engine) {
    room.syncSuspended = true;
    try {
      room.engine.setState({ roomPaused: false, roomPauseReason: null });
    } finally {
      room.syncSuspended = false;
    }
  }
  broadcast(roomCode, { type: 'room_resumed' });
  broadcastRoomSnapshot(roomCode);
  scheduleBotAction(roomCode);
  persistRooms();
  return true;
}

function syncRoomStateFromEngine(roomCode, { full = false } = {}) {
  const room = rooms[roomCode];
  if (!room || !room.engine) return null;
  room.state = serializeState(room.engine.getState());
  broadcastStateUpdate(roomCode, { full });
  initializeMatchOverRoom(roomCode);
  scheduleBotAction(roomCode);
  persistRooms();
  return room.state;
}

function initializeMatchOverRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room || !isChipMatchOverState(room.state)) return false;
  if (!Array.isArray(room.matchReady) || room.matchReady.length !== 4) {
    room.matchReady = createMatchReadyState(room.state.players);
    room.rematchCountdown = null;
  }
  broadcast(roomCode, {
    type: 'match_ready_state',
    ready: [...room.matchReady],
    countdown: room.rematchCountdown,
  });
  return true;
}

function buildRoomRoster(room) {
  return Array.from({ length: 4 }, (_, playerIndex) => {
    const statePlayer = room.state?.players?.[playerIndex] || {};
    const isHuman = playerIndex === 0 ? true : Boolean(room.players[playerIndex - 1]);
    return {
      id: playerIndex,
      name: room.names[playerIndex] || statePlayer.name || (isHuman ? `Player ${playerIndex + 1}` : ['Sakura', 'Mei Lin', 'Kenji'][playerIndex - 1]),
      isHuman,
    };
  });
}

function startRematch(oldRoomCode) {
  const room = rooms[oldRoomCode];
  if (!room || room.paused || !isChipMatchOverState(room.state)) return;

  let newRoomCode = createRoomCode();
  while (rooms[newRoomCode]) newRoomCode = createRoomCode();

  clearRematchCountdownTimer(oldRoomCode);
  clearStartStateTimer(oldRoomCode);
  clearBotActionTimer(oldRoomCode);
  clearStateSyncTimer(oldRoomCode);

  const config = JSON.parse(JSON.stringify(room.originalConfig || room.config || room.state.config));
  const roster = buildRoomRoster(room);
  const seed = Math.floor(Math.random() * 2147483647);
  const nextState = buildInitialMultiplayerState({
    config,
    seed,
    roster,
    previousState: null,
  });

  delete rooms[oldRoomCode];
  rooms[newRoomCode] = room;
  room.code = newRoomCode;
  room.config = config;
  room.seed = seed;
  room.ready = [false, false, false, false];
  room.matchReady = null;
  room.rematchCountdown = null;
  room.rematchCountdownTimer = null;
  room.started = true;
  room.paused = false;
  room.pauseReason = null;

  for (const socket of [room.host, ...room.players]) {
    if (socket) socket.sgRoomCode = newRoomCode;
  }

  room.syncSuspended = true;
  try {
    room.state = nextState.state;
    const engine = ensureRoomEngine(newRoomCode);
    if (engine) engine.setState(nextState.state);
  } finally {
    room.syncSuspended = false;
  }

  broadcast(newRoomCode, {
    type: 'room_recreated',
    oldCode: oldRoomCode,
    code: newRoomCode,
  });
  broadcast(newRoomCode, {
    type: 'game_started',
    config,
    seed,
    playerCount: 4,
    hostIndex: 0,
    mode: 'lobby',
  });
  broadcast(newRoomCode, {
    type: 'dice_results',
    dice: nextState.diceResults.dice,
    totals: nextState.diceResults.totals,
    eastPlayerIdx: nextState.diceResults.eastPlayerIdx,
    playerCount: 4,
    myPlayerIndex: 0,
  });
  syncRoomStateFromEngine(newRoomCode, { full: true });
}

function updateRematchCountdown(roomCode, countdown) {
  const room = rooms[roomCode];
  if (!room) return;
  room.rematchCountdown = countdown;
  broadcast(roomCode, { type: 'rematch_countdown', countdown });
}

function scheduleRematchCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.paused || !areAllMatchSeatsReady(room.matchReady)) return;
  if (room.rematchCountdownTimer || room.rematchCountdown !== null) return;

  updateRematchCountdown(roomCode, 5);
  const tick = () => {
    const current = rooms[roomCode];
    if (!current || current.paused || !areAllMatchSeatsReady(current.matchReady)) {
      if (current) {
        current.rematchCountdownTimer = null;
        updateRematchCountdown(roomCode, null);
      }
      return;
    }
    const next = Math.max(0, Number(current.rematchCountdown) - 1);
    updateRematchCountdown(roomCode, next);
    if (next === 0) {
      current.rematchCountdownTimer = null;
      startRematch(roomCode);
      return;
    }
    current.rematchCountdownTimer = setTimeout(tick, 1000);
  };
  room.rematchCountdownTimer = setTimeout(tick, 1000);
}

function chooseBotDiscardIndex(hand, melds) {
  const candidates = [];
  for (let i = 0; i < (hand || []).length; i++) {
    const tile = hand[i];
    if (!tile || tile.category === 'fei' || tile.category === 'bonus') continue;

    let score = 0;
    if (tile.category === 'honor') {
      score = 60;
    } else if (tile.category === 'suit') {
      if (tile.value === 1 || tile.value === 9) score = 10;
      else if (tile.value === 2 || tile.value === 8) score = 25;
      else if (tile.value === 3 || tile.value === 7) score = 40;
      else score = 55;

      const neighbors = (hand || []).filter(other =>
        other?.category === 'suit' &&
        other.suit === tile.suit &&
        Math.abs(other.value - tile.value) <= 2,
      ).length;
      if (neighbors <= 2) score -= 20;
      if ((hand || []).filter(other =>
        other?.category === tile.category &&
        ((tile.category === 'suit' && other.suit === tile.suit && other.value === tile.value) ||
         (tile.category === 'honor' && other.type === tile.type)),
      ).length === 1) {
        score -= 10;
      }
      if ((hand || []).filter(other =>
        other?.category === tile.category &&
        ((tile.category === 'suit' && other.suit === tile.suit && other.value === tile.value) ||
         (tile.category === 'honor' && other.type === tile.type)),
      ).length >= 2) {
        score += 20;
      }
    }

    candidates.push({ index: i, score });
  }

  if (candidates.length === 0) return 0;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].index;
}

function scheduleBotAction(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.started || room.paused || !room.engine) return;

  const state = room.engine.getState();
  if (!state || state.phase !== 'playing') return;
  if (state.waitingForClaim && state.waitingForClaim.tile) return;

  const currentPlayer = state.players?.[state.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.isHuman) return;

  clearBotActionTimer(roomCode);
  room.botActionTimer = setTimeout(() => {
    try {
      const current = rooms[roomCode];
      if (!current || current.paused || !current.engine) return;
      const nextState = current.engine.getState();
      if (!nextState || nextState.phase !== 'playing') return;
      if (nextState.waitingForClaim && nextState.waitingForClaim.tile) return;
      const bot = nextState.players?.[nextState.currentPlayerIndex];
      if (!bot || bot.isHuman) return;

      const discardIdx = chooseBotDiscardIndex(bot.hand || [], bot.melds || []);
      if (discardIdx >= 0) {
        const storeState = current.engine.getState();
        const discardTile = storeState && storeState.discardTile;
        if (typeof discardTile !== 'function') {
          throw new TypeError('discardTile is not available on the bot engine state');
        }
        discardTile(nextState.currentPlayerIndex, discardIdx);
      }
    } catch (err) {
      console.error(`Bot action failed for room ${roomCode}:`, err);
    }
  }, 800);
}

function scheduleRestartRecoveryTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearRecoveryTimer(roomCode);
  room.recoveryTimer = setTimeout(() => {
    const current = rooms[roomCode];
    if (!current || areAllHumanSeatsConnected(current)) return;
    broadcast(roomCode, { type: 'room_closed', reason: 'restart_recovery_timeout' });
    destroyRoom(roomCode);
  }, RESTART_RECOVERY_TIMEOUT_MS);
}

function restorePersistedRooms() {
  const restoredRooms = persistence.load();
  for (const snapshot of restoredRooms) {
    const code = normalizeRoomCode(snapshot.code);
    if (!code || rooms[code]) continue;
    const humanSeats = Array.isArray(snapshot.humanSeats) && snapshot.humanSeats.length === 4
      ? snapshot.humanSeats.map(Boolean)
      : [true, false, false, false];
    humanSeats[0] = true;
    rooms[code] = {
      code,
      host: null,
      players: [null, null, null],
      names: Array.from({ length: 4 }, (_, index) => snapshot.names?.[index] || null),
      config: snapshot.config || null,
      originalConfig: snapshot.originalConfig || snapshot.config || null,
      seed: snapshot.seed || null,
      ready: Array.from({ length: 4 }, (_, index) => Boolean(snapshot.ready?.[index])),
      started: Boolean(snapshot.started),
      state: snapshot.state || null,
      engine: null,
      engineStateUnsubscribe: null,
      paused: true,
      pauseReason: { type: 'server_restart' },
      emptyRoomTimer: null,
      hostDisconnectTimer: null,
      startStateTimer: null,
      botActionTimer: null,
      matchReady: Array.isArray(snapshot.matchReady) ? snapshot.matchReady.map(Boolean) : null,
      rematchCountdown: null,
      rematchCountdownTimer: null,
      syncSuspended: false,
      recoveryTimer: null,
      seatDisconnectTimers: [null, null, null],
      stateSyncTimer: null,
      stateRevision: Number.isInteger(snapshot.stateRevision) ? snapshot.stateRevision : 0,
      lastBroadcastMoveCount: snapshot.state?.moveHistory?.length || 0,
      seatTokens: snapshot.seatTokens,
      humanSeats,
    };
    if (rooms[code].state) {
      rooms[code].state.debugLogs = [];
      rooms[code].state.roomPaused = true;
      rooms[code].state.roomPauseReason = { type: 'server_restart' };
      ensureRoomEngine(code);
    }
    scheduleRestartRecoveryTimer(code);
    operations.counters.roomsRestored++;
  }
  if (restoredRooms.length > 0) persistRooms();
}

wss.on('connection', (ws, request) => {
  const clientIp = getClientIp(request, TRUST_PROXY);
  if (wss.clients.size > MAX_CONNECTIONS) {
    operations.counters.connectionsRejected++;
    ws.close(1013, 'The multiplayer server is at connection capacity');
    return;
  }
  if (!connectionCounter.acquire(clientIp)) {
    operations.counters.connectionsRejected++;
    ws.close(1013, 'Too many connections from this network');
    return;
  }
  operations.counters.connectionsAccepted++;
  ws.sgClientIp = clientIp;
  ws.sgConnectionId = createReconnectToken();
  ws.sgReleased = false;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let currentRoom = null;
  let playerIndex = -1;

  ws.on('message', (data, isBinary) => {
    try {
      operations.counters.messagesReceived++;
      if (isBinary) {
        operations.counters.messagesRejected++;
        return send(ws, { type: 'error', message: 'Binary messages are not supported' });
      }
      const rate = messageLimiter.consume(ws.sgConnectionId);
      if (!rate.allowed) {
        operations.counters.messagesRejected++;
        operations.counters.rateLimited++;
        send(ws, { type: 'error', message: 'Too many messages. Please slow down.' });
        ws.close(1008, 'Message rate limit exceeded');
        return;
      }
      if (ws.sgRoomCode) currentRoom = ws.sgRoomCode;
      const msg = JSON.parse(data.toString());
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
        operations.counters.messagesRejected++;
        return send(ws, { type: 'error', message: 'Invalid message' });
      }

      switch (msg.type) {

        case 'create_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });
          if (Object.keys(rooms).length >= MAX_ROOMS) {
            return send(ws, { type: 'error', message: 'The server is at room capacity. Please try again shortly.' });
          }
          const createRate = roomCreateLimiter.consume(clientIp);
          if (!createRate.allowed) {
            operations.counters.rateLimited++;
            return send(ws, { type: 'error', message: 'Too many rooms created from this network. Please try again later.' });
          }

          let code = createRoomCode();
          while (rooms[code]) code = createRoomCode();
          const seatTokens = Array.from({ length: 4 }, () => createReconnectToken());

          rooms[code] = {
            code,
            host: ws,
            players: [null, null, null],
            names: [null, null, null, null],
            config: null,
            originalConfig: null,
            seed: null,
            ready: [false, false, false, false],
            started: false,
            state: null,
            engine: null,
            paused: false,
            pauseReason: null,
            emptyRoomTimer: null,
            hostDisconnectTimer: null,
            startStateTimer: null,
            botActionTimer: null,
            matchReady: null,
            rematchCountdown: null,
            rematchCountdownTimer: null,
            syncSuspended: false,
            recoveryTimer: null,
            seatDisconnectTimers: [null, null, null],
            stateSyncTimer: null,
            stateRevision: 0,
            lastBroadcastMoveCount: 0,
            seatTokens,
            humanSeats: [true, false, false, false],
          };
          currentRoom = code;
          playerIndex = 0;
          ws.sgRoomCode = code;

          operations.counters.roomsCreated++;
          send(ws, { type: 'room_created', code, playerIndex: 0, reconnectToken: seatTokens[0] });
          scheduleEmptyRoomTimer(code);
          persistRooms();
          break;
        }

        case 'join_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });

          const code = normalizeRoomCode(msg.code);
          if (!code) return send(ws, { type: 'error', message: 'Invalid room code' });
          const room = rooms[code];
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          if (room.started) return send(ws, { type: 'error', message: 'Room already in progress. Rejoin using your saved seat.' });

          const freeSlot = room.players.findIndex((socket, seatIndex) =>
            socket === null && !room.humanSeats[seatIndex + 1]
          );
          if (freeSlot === -1) return send(ws, { type: 'error', message: 'Room is full' });

          room.players[freeSlot] = ws;
          room.humanSeats[freeSlot + 1] = true;
          clearSeatDisconnectTimer(code, freeSlot);
          clearEmptyRoomTimer(code);
          clearRecoveryTimer(code);
          currentRoom = code;
          playerIndex = freeSlot + 1;
          ws.sgRoomCode = code;

          send(ws, {
            type: 'room_joined',
            code,
            playerIndex: freeSlot + 1,
            reconnectToken: room.seatTokens[freeSlot + 1],
          });
          sendRoomSnapshot(code, ws, freeSlot + 1);
          if (room.started && room.state) {
            sendFullState(code, ws);
          }
          broadcast(code, { type: 'player_joined', playerIndex: freeSlot + 1 });
          broadcastRoomSnapshot(code);

          // Check if room is now full
          if (room.players.every(p => p !== null)) {
            broadcast(code, { type: 'room_full' });
          }
          persistRooms();
          break;
        }

        case 'start_game': {
          if (!currentRoom || playerIndex !== 0) return;
          const room = rooms[currentRoom];
          if (!room || room.paused) return;
          const startMode = msg.mode === 'round' ? 'round' : 'lobby';
          if (room.started && isChipMatchOverState(room.state)) {
            return send(ws, { type: 'error', message: 'The chip match is over. All seats must use Play Again.' });
          }
          clearEmptyRoomTimer(currentRoom);
          clearHostDisconnectTimer(currentRoom);
          clearRecoveryTimer(currentRoom);
          clearStartStateTimer(currentRoom);
          clearStateSyncTimer(currentRoom);
          room.config = sanitizeConfig(msg.config);
          if (startMode === 'lobby' && !room.originalConfig) {
            room.originalConfig = JSON.parse(JSON.stringify(room.config));
          }
          room.seed = Math.floor(Math.random() * 2147483647);
          room.started = true;
          room.ready = [false, false, false, false];
          room.matchReady = null;
          room.rematchCountdown = null;
          clearRematchCountdownTimer(currentRoom);
          const engine = ensureRoomEngine(currentRoom);

          const playerCount = 4;
          const roster = Array.from({ length: 4 }, (_, p) => {
            const provided = Array.isArray(msg.players) && msg.players[p] ? msg.players[p] : {};
            const isHuman = p === 0 ? true : Boolean(room.players[p - 1]);
            const defaultName = p === 0
              ? 'Player 1'
              : isHuman
                ? `Player ${p + 1}`
                : ['Sakura', 'Mei Lin', 'Kenji'][p - 1];
            return {
              name: sanitizeName(provided.name || room.names[p], defaultName),
              isHuman,
            };
          });
          room.humanSeats = roster.map(player => player.isHuman);

          const hasPreviousState = Boolean(room.state && Array.isArray(room.state.players) && room.state.players.length === 4);
          broadcast(currentRoom, {
            type: 'game_started',
            config: room.config,
            seed: room.seed,
            playerCount,
            hostIndex: 0,
            mode: startMode,
          });
          const nextState = buildInitialMultiplayerState({
            config: room.config,
            seed: room.seed,
            roster,
            previousState: startMode === 'round' && hasPreviousState ? room.state : null,
          });
          if (startMode === 'lobby') {
            broadcast(currentRoom, {
              type: 'dice_results',
              dice: nextState.diceResults.dice,
              totals: nextState.diceResults.totals,
              eastPlayerIdx: nextState.diceResults.eastPlayerIdx,
              playerCount,
              myPlayerIndex: 0,
            });
          }
          room.syncSuspended = true;
          try {
            room.state = nextState.state;
            if (engine) {
              engine.setState(nextState.state);
            }
          } finally {
            room.syncSuspended = false;
          }
          syncRoomStateFromEngine(currentRoom, { full: true });
          const roomCode = currentRoom;
          room.startStateTimer = setTimeout(() => {
            const current = rooms[roomCode];
            if (!current || !current.started || current.paused || !current.host) return;
            broadcastInitialState(roomCode);
          }, 7000);
          break;
        }

       case 'action': {
         if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room || room.paused) return;
          if (!isValidActionMessage(msg)) {
            operations.counters.messagesRejected++;
            return send(ws, { type: 'error', message: 'Invalid game action', clientActionId: msg?.clientActionId });
          }
          const engine = ensureRoomEngine(currentRoom);
          if (!engine) return;
          const actor = playerIndex;
          if (actor < 0 || actor > 3 || room.state?.players?.[actor]?.isHuman === false) {
            operations.counters.messagesRejected++;
            return send(ws, { type: 'error', message: 'This seat cannot perform that action', clientActionId: msg.clientActionId });
          }
          const state = engine.getState();
          if (state.phase !== 'playing') return;
          const eligibleActions = state.waitingForClaim?.eligiblePlayers
            ?.find(entry => entry.playerIndex === actor)?.actions || [];
          const isCurrentPlayer = state.currentPlayerIndex === actor;
          const actionAllowed =
            (msg.actionType === 'discard' && isCurrentPlayer && !state.waitingForClaim?.tile) ||
            (['self_draw_win', 'pass_self_draw', 'self_kong', 'concealed_kong', 'pass_self_kong'].includes(msg.actionType) && isCurrentPlayer && !state.waitingForClaim?.tile) ||
            (['win', 'kong', 'pung', 'chi'].includes(msg.actionType) && eligibleActions.includes(msg.actionType)) ||
            (msg.actionType === 'pass_claim' && eligibleActions.length > 0);
          if (!actionAllowed) {
            operations.counters.messagesRejected++;
            return send(ws, { type: 'error', message: 'That action is not currently available for your seat', clientActionId: msg.clientActionId });
          }

          switch (msg.actionType) {
            case 'discard':
              state.discardTile(actor, msg.data?.tileIndex);
              break;
            case 'self_draw_win':
              state.selfDrawWinAction(actor);
              break;
            case 'pass_self_draw':
              state.passSelfDrawWin();
              break;
            case 'win':
            case 'kong':
            case 'pung':
            case 'chi':
              state.claimTile(actor, msg.actionType, msg.data?.chiTiles);
              break;
            case 'pass_claim':
              state.passClaim();
              break;
            case 'self_kong':
              state.selfKongAction(actor, msg.data?.meldIndex, msg.data?.handTileIndex);
              break;
            case 'concealed_kong':
              state.concealedKongAction(actor, msg.data?.tileIndex);
              break;
            case 'pass_self_kong':
              state.passSelfKong();
              break;
            default:
              return;
          }
          if (msg.clientActionId) {
            room.pendingActionAcks = Array.isArray(room.pendingActionAcks) ? room.pendingActionAcks : [];
            room.pendingActionAcks.push({
              clientActionId: msg.clientActionId,
              playerIndex: actor,
            });
          }
          break;
        }

        case 'leave_room': {
          if (currentRoom) {
            const room = rooms[currentRoom];
            if (room && playerIndex > 0 && !room.started) {
              releaseLobbySeat(currentRoom, playerIndex - 1);
            } else {
              cleanupRoom(currentRoom, ws);
            }
            currentRoom = null;
            playerIndex = -1;
            ws.sgRoomCode = '';
          }
          break;
        }

        case 'quit_room': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room) return;
          const quitter = playerIndex >= 0 ? playerIndex : null;
          broadcast(currentRoom, { type: 'room_closed', reason: 'player_quit', playerIndex: quitter });
          destroyRoom(currentRoom);
          currentRoom = null;
          playerIndex = -1;
          ws.sgRoomCode = '';
          break;
        }

        case 'host_quit': {
          if (!currentRoom || playerIndex !== 0) return;
          const room = rooms[currentRoom];
          if (!room) return;
          clearEmptyRoomTimer(currentRoom);
          clearHostDisconnectTimer(currentRoom);
          clearStartStateTimer(currentRoom);
          broadcast(currentRoom, { type: 'room_closed', reason: 'host_quit' });
          destroyRoom(currentRoom);
          currentRoom = null;
          playerIndex = -1;
          ws.sgRoomCode = '';
          break;
        }

        case 'player_ready': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room || room.paused) return;
          const pIdx = playerIndex;
          if (pIdx < 0 || pIdx > 3) return;
          room.ready[pIdx] = Boolean(msg.ready);
          broadcast(currentRoom, { type: 'player_ready', playerIndex: pIdx, ready: room.ready[pIdx] });
          persistRooms();
          break;
        }

        case 'match_ready': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room || room.paused || !isChipMatchOverState(room.state)) return;
          if (!Array.isArray(room.matchReady) || room.matchReady.length !== 4) {
            room.matchReady = createMatchReadyState(room.state.players);
          }
          if (playerIndex < 0 || playerIndex > 3 || room.state.players?.[playerIndex]?.isHuman === false) return;
          room.matchReady[playerIndex] = Boolean(msg.ready);
          broadcast(currentRoom, {
            type: 'match_ready_state',
            ready: [...room.matchReady],
            countdown: room.rematchCountdown,
          });
          persistRooms();
          if (!areAllMatchSeatsReady(room.matchReady)) {
            clearRematchCountdownTimer(currentRoom);
            updateRematchCountdown(currentRoom, null);
            return;
          }
          scheduleRematchCountdown(currentRoom);
          break;
        }

        case 'rejoin_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });
          const code = normalizeRoomCode(msg.code);
          if (!code) return send(ws, { type: 'error', message: 'Invalid room code' });
          const room2 = rooms[code];
          if (!room2) return send(ws, { type: 'error', message: 'Room not found' });
          if (!Number.isInteger(msg.playerIndex) || msg.playerIndex < 0 || msg.playerIndex > 3) {
            return send(ws, { type: 'error', message: 'Invalid seat' });
          }
          if (!room2.humanSeats?.[msg.playerIndex]) {
            return send(ws, { type: 'error', message: 'That seat is not assigned to a real player' });
          }
          if (!tokenMatches(msg.reconnectToken, room2.seatTokens?.[msg.playerIndex])) {
            operations.counters.messagesRejected++;
            return send(ws, { type: 'error', message: 'Invalid reconnect credentials' });
          }
          playerIndex = msg.playerIndex;
          if (playerIndex === 0) {
            const prevHost = room2.host;
            room2.host = ws;
            clearHostDisconnectTimer(code);
            if (prevHost && prevHost !== ws) {
              try {
                prevHost.close();
              } catch {}
            }
          } else {
            const seatIdx = playerIndex - 1;
            clearSeatDisconnectTimer(code, seatIdx);
            const prevWs = room2.players[seatIdx];
            if (prevWs && prevWs !== ws) {
              room2.players[seatIdx] = null;
              room2.ready[seatIdx] = false;
              broadcast(code, { type: 'player_left', playerIndex: msg.playerIndex });
              room2.paused = true;
              room2.pauseReason = { type: 'player_left', playerIndex: msg.playerIndex };
              broadcastRoomPaused(code, room2.pauseReason);
              try {
                prevWs.close();
              } catch {}
            }
            room2.players[seatIdx] = ws;
          }
          clearEmptyRoomTimer(code);
          clearStartStateTimer(code);
          currentRoom = code;
          ws.sgRoomCode = code;
          send(ws, {
            type: 'room_joined',
            code,
            playerIndex: msg.playerIndex,
            reconnectToken: room2.seatTokens[msg.playerIndex],
          });
          sendRoomSnapshot(code, ws, msg.playerIndex);
          if (room2.started && room2.state) {
            sendFullState(code, ws);
          }
          broadcast(code, { type: 'player_joined', playerIndex: msg.playerIndex });
          broadcastRoomSnapshot(code);
          resumeRoomIfComplete(code);
          persistRooms();
          break;
        }

        case 'player_name': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (room && playerIndex >= 0 && playerIndex < 4) {
            const name = sanitizeName(msg.name, `Player ${playerIndex + 1}`);
            room.names[playerIndex] = name;
            if (room.state?.players?.[playerIndex]) {
              room.state.players[playerIndex].name = name;
            }
            if (room.engine?.getState?.().players?.[playerIndex]) {
              const nextState = room.engine.getState();
              nextState.players[playerIndex].name = name;
              room.engine.setState({ players: nextState.players });
            }
            broadcast(currentRoom, { type: 'player_name', playerIndex, name });
            persistRooms();
          }
          break;
        }
        default:
          operations.counters.messagesRejected++;
          send(ws, { type: 'error', message: 'Unsupported message type' });
          break;
      }
    } catch (e) {
      operations.counters.messagesRejected++;
      send(ws, { type: 'error', message: 'Invalid message' });
    }
  });

  ws.on('close', () => {
    if (!ws.sgReleased) {
      ws.sgReleased = true;
      connectionCounter.release(clientIp);
    }
    const closingRoom = ws.sgRoomCode || currentRoom;
    if (closingRoom) {
      // cleanupRoom handles the player_left broadcast
      cleanupRoom(closingRoom, ws);
    }
  });
  ws.on('error', () => {
    // The close handler owns room cleanup and connection accounting.
  });
});

function cleanupRoom(code, ws) {
  const room = rooms[code];
  if (!room) return;

  if (ws === room.host) {
    // Host disconnected transiently - keep the room alive briefly so mobile app-switches can recover
    room.host = null;
    room.paused = true;
    room.pauseReason = { type: 'host_left' };
    broadcast(code, { type: 'host_left' });
    broadcastRoomPaused(code, room.pauseReason);
    scheduleHostDisconnectTimer(code);
    persistRooms();
  } else {
    const idx = room.players.indexOf(ws);
    if (idx !== -1) {
      room.players[idx] = null;
      room.ready[idx + 1] = false;
      room.paused = true;
      room.pauseReason = { type: 'player_left', playerIndex: idx + 1 };
      broadcast(code, { type: 'player_left', playerIndex: idx + 1 });
      broadcastRoomPaused(code, room.pauseReason);
      scheduleSeatDisconnectTimer(code, idx);
      scheduleEmptyRoomTimer(code);
      persistRooms();
    }
  }
}

restorePersistedRooms();

const heartbeatTimer = setInterval(() => {
  messageLimiter.cleanup();
  roomCreateLimiter.cleanup();
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch {}
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      try {
        ws.terminate();
      } catch {}
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; persisting rooms before shutdown.`);
  clearInterval(heartbeatTimer);
  try {
    persistence.close(rooms);
  } catch (error) {
    console.error('Failed to persist rooms during shutdown:', error);
  }
  operations.close();
  httpServer.close();
  setTimeout(() => process.exit(0), 250).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

httpServer.listen(PORT, () => {
  console.log(`Mahjong server running on ws://localhost:${PORT}`);
});
