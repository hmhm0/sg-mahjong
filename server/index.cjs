const { WebSocketServer } = require('ws');
const { buildInitialMultiplayerState } = require('./roundSetup.cjs');
const { createTsRuntime } = require('./ts-runtime.cjs');
const path = require('path');

const PORT = 3002;
const wss = new WebSocketServer({ port: PORT });

const EMPTY_ROOM_TIMEOUT_MS = 10 * 60 * 1000;
const rooms = {}; // code -> { host, players, names, config, seed, ready, started, state, engine, paused, pauseReason, emptyRoomTimer, hostDisconnectTimer, startStateTimer, botActionTimer, syncSuspended }
const HOST_DISCONNECT_TIMEOUT_MS = 2 * 60 * 1000;
const GAME_STORE_ENTRY = path.resolve(__dirname, '../src/store/gameStore.ts');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function broadcast(roomCode, message, exclude = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const msg = JSON.stringify(message);
  for (const ws of [room.host, ...room.players]) {
    if (ws && ws !== exclude && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function send(ws, message) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

function serializeState(state) {
  const payload = {};
  for (const key of Object.keys(state || {})) {
    const value = state[key];
    if (typeof value !== 'function') payload[key] = value;
  }
  return payload;
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

function destroyRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearEmptyRoomTimer(roomCode);
  clearHostDisconnectTimer(roomCode);
  clearStartStateTimer(roomCode);
  clearBotActionTimer(roomCode);
  if (typeof room.engineStateUnsubscribe === 'function') {
    try {
      room.engineStateUnsubscribe();
    } catch {}
    room.engineStateUnsubscribe = null;
  }
  delete rooms[roomCode];
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
  broadcast(roomCode, {
    type: 'state_update',
    state: room.state,
  });
  scheduleBotAction(roomCode);
}

function ensureRoomEngine(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;
  if (room.engine) return room.engine;
  const runtime = createTsRuntime();
  const exports = runtime.load(GAME_STORE_ENTRY);
  room.engine = exports.useGameStore;
  if (!room.engineStateUnsubscribe && typeof room.engine.subscribe === 'function') {
    room.engineStateUnsubscribe = room.engine.subscribe(() => {
      const current = rooms[roomCode];
      if (!current || current.engine !== room.engine || current.syncSuspended) return;
      syncRoomStateFromEngine(roomCode);
    });
  }
  return room.engine;
}

function syncRoomStateFromEngine(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.engine) return null;
  room.state = serializeState(room.engine.getState());
  broadcast(roomCode, {
    type: 'state_update',
    state: room.state,
  });
  scheduleBotAction(roomCode);
  return room.state;
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
        syncRoomStateFromEngine(roomCode);
      }
    } catch (err) {
      console.error(`Bot action failed for room ${roomCode}:`, err);
    }
  }, 800);
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerIndex = -1;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {

        case 'create_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });

          let code = generateCode();
          while (rooms[code]) code = generateCode();

          rooms[code] = {
            host: ws,
            players: [null, null, null],
            names: [null, null, null, null],
            config: null,
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
            syncSuspended: false,
          };
          currentRoom = code;
          playerIndex = 0;

          send(ws, { type: 'room_created', code, playerIndex: 0 });
          scheduleEmptyRoomTimer(code);
          break;
        }

        case 'join_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });

          const room = rooms[msg.code];
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          if (room.started) return send(ws, { type: 'error', message: 'Room already in progress. Rejoin using your saved seat.' });

          const freeSlot = room.players.findIndex(p => p === null);
          if (freeSlot === -1) return send(ws, { type: 'error', message: 'Room is full' });

          room.players[freeSlot] = ws;
          clearEmptyRoomTimer(msg.code);
          currentRoom = msg.code;
          playerIndex = freeSlot + 1;

          send(ws, { type: 'room_joined', code: msg.code, playerIndex: freeSlot + 1 });
          sendRoomSnapshot(msg.code, ws, freeSlot + 1);
          if (room.started && room.state) {
            send(ws, { type: 'state_update', state: room.state });
          }
          broadcast(msg.code, { type: 'player_joined', playerIndex: freeSlot + 1 });
          broadcastRoomSnapshot(msg.code);

          // Check if room is now full
          if (room.players.every(p => p !== null)) {
            broadcast(msg.code, { type: 'room_full' });
          }
          break;
        }

        case 'start_game': {
          if (!currentRoom || playerIndex !== 0) return;
          const room = rooms[currentRoom];
          if (!room || room.paused) return;
          const startMode = msg.mode === 'round' ? 'round' : 'lobby';
          clearEmptyRoomTimer(currentRoom);
          clearHostDisconnectTimer(currentRoom);
          clearStartStateTimer(currentRoom);
          room.config = msg.config;
          room.seed = Math.floor(Math.random() * 2147483647);
          room.started = true;
          room.ready = [false, false, false, false];
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
              name: (provided.name && String(provided.name).trim()) || room.names[p] || defaultName,
              isHuman,
            };
          });

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
          syncRoomStateFromEngine(currentRoom);
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
          const engine = ensureRoomEngine(currentRoom);
          if (!engine) return;
          const actor = playerIndex >= 0 ? playerIndex : (msg.playerIndex ?? msg.data?.playerIdx ?? -1);
          const state = engine.getState();
          if (state.phase !== 'playing') return;

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
          break;
        }

        case 'leave_room': {
          if (currentRoom) {
            // cleanupRoom handles the player_left broadcast
            cleanupRoom(currentRoom, ws);
          }
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
          break;
        }

        case 'player_ready': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room || room.paused) return;
          const pIdx = msg.playerIndex;
          if (pIdx >= 0 && pIdx < 4) {
            room.ready[pIdx] = msg.ready;
            broadcast(currentRoom, { type: 'player_ready', playerIndex: pIdx, ready: msg.ready });
          }
          break;
        }

        case 'rejoin_room': {
          if (currentRoom) return send(ws, { type: 'error', message: 'Already in a room' });
          const room2 = rooms[msg.code];
          if (!room2) return send(ws, { type: 'error', message: 'Room not found' });
          if (msg.playerIndex < 0 || msg.playerIndex > 3) return send(ws, { type: 'error', message: 'Invalid seat' });
          playerIndex = msg.playerIndex;
          if (playerIndex === 0) {
            const prevHost = room2.host;
            room2.host = ws;
            clearHostDisconnectTimer(msg.code);
            room2.paused = false;
            room2.pauseReason = null;
            if (prevHost && prevHost !== ws) {
              try {
                prevHost.close();
              } catch {}
            }
            broadcast(msg.code, { type: 'room_resumed' });
          } else {
            const seatIdx = playerIndex - 1;
            const prevWs = room2.players[seatIdx];
            if (prevWs && prevWs !== ws) {
              room2.players[seatIdx] = null;
              room2.ready[seatIdx] = false;
              broadcast(msg.code, { type: 'player_left', playerIndex: msg.playerIndex });
              room2.paused = true;
              room2.pauseReason = { type: 'player_left', playerIndex: msg.playerIndex };
              broadcastRoomPaused(msg.code, room2.pauseReason);
              try {
                prevWs.close();
              } catch {}
            }
            room2.players[seatIdx] = ws;
          }
          clearEmptyRoomTimer(msg.code);
          clearStartStateTimer(msg.code);
          currentRoom = msg.code;
          send(ws, { type: 'room_joined', code: msg.code, playerIndex: msg.playerIndex });
          sendRoomSnapshot(msg.code, ws, msg.playerIndex);
          if (room2.started && room2.state) {
            send(ws, { type: 'state_update', state: room2.state });
          }
          broadcast(msg.code, { type: 'player_joined', playerIndex: msg.playerIndex });
          broadcastRoomSnapshot(msg.code);
          break;
        }

        case 'player_name': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (room && msg.playerIndex >= 0 && msg.playerIndex < 4) {
            room.names[msg.playerIndex] = msg.name;
            if (room.state?.players?.[msg.playerIndex]) {
              room.state.players[msg.playerIndex].name = msg.name;
            }
            if (room.engine?.getState?.().players?.[msg.playerIndex]) {
              const nextState = room.engine.getState();
              nextState.players[msg.playerIndex].name = msg.name;
              room.engine.setState({ players: nextState.players });
            }
          }
          // Broadcast the player's name to all clients
          broadcast(currentRoom, { type: 'player_name', playerIndex: msg.playerIndex, name: msg.name });
          break;
        }
     }
    } catch (e) {
      send(ws, { type: 'error', message: 'Invalid message' });
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      // cleanupRoom handles the player_left broadcast
      cleanupRoom(currentRoom, ws);
    }
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
  } else {
    const idx = room.players.indexOf(ws);
    if (idx !== -1) {
      room.players[idx] = null;
      room.ready[idx + 1] = false;
      room.paused = true;
      room.pauseReason = { type: 'player_left', playerIndex: idx + 1 };
      broadcast(code, { type: 'player_left', playerIndex: idx + 1 });
      broadcastRoomPaused(code, room.pauseReason);
    scheduleEmptyRoomTimer(code);
    }
  }
}

console.log(`Mahjong server running on ws://localhost:${PORT}`);
