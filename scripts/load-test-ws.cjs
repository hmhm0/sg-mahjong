const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const shouldSpawn = process.argv.includes('--spawn');
const roomCount = Number.parseInt(process.env.LOAD_TEST_ROOMS || '25', 10);
const clientsPerRoom = 4;
const durationMs = Number.parseInt(process.env.LOAD_TEST_DURATION_MS || '15000', 10);
const port = Number.parseInt(process.env.LOAD_TEST_PORT || '3102', 10);
const serverUrl = process.env.LOAD_TEST_URL || `ws://127.0.0.1:${port}`;
const healthUrl = serverUrl.replace(/^ws/, 'http').replace(/\/+$/, '') + '/health';

const config = {
  taiThreshold: 4,
  unlimitedTai: false,
  feiCount: 4,
  payoutTable: 'none',
  startingChips: null,
  shooterEnabled: false,
  maxTai: 10,
  specialTaiCapEnabled: false,
  specialTaiCap: 18,
  economyEnabled: false,
  chipSettlementMode: 'default',
};

let child = null;
let tempDir = null;
const sockets = [];
const stats = {
  messages: 0,
  bytes: 0,
  actions: 0,
  errors: 0,
  unexpectedCloses: 0,
  actionAcks: 0,
};
let closing = false;
let actionSequence = 0;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return response.json();
    } catch {}
    await wait(100);
  }
  throw new Error(`Server health endpoint did not become ready: ${healthUrl}`);
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl);
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10000);
    ws.messages = [];
    ws.waiters = [];
    ws.on('open', () => {
      clearTimeout(timeout);
      sockets.push(ws);
      resolve(ws);
    });
    ws.on('message', data => {
      stats.messages++;
      stats.bytes += data.length;
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        stats.errors++;
        return;
      }
      if (Array.isArray(message.actionAcks)) {
        stats.actionAcks += message.actionAcks.length;
      }
      ws.messages.push(message);
      for (const waiter of [...ws.waiters]) {
        if (waiter.predicate(message)) {
          ws.waiters.splice(ws.waiters.indexOf(waiter), 1);
          clearTimeout(waiter.timeout);
          waiter.resolve(message);
        }
      }
    });
    ws.on('close', () => {
      if (!closing) stats.unexpectedCloses++;
    });
    ws.on('error', error => {
      if (!closing) {
        stats.errors++;
        reject(error);
      }
    });
  });
}

function waitForMessage(ws, predicate, timeoutMs = 10000) {
  const existing = ws.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        ws.waiters.splice(ws.waiters.indexOf(waiter), 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs),
    };
    ws.waiters.push(waiter);
  });
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

async function createRoom(roomIndex) {
  const clients = [];
  const host = await connectClient();
  clients.push(host);
  send(host, { type: 'create_room' });
  const created = await waitForMessage(host, message => message.type === 'room_created');

  for (let playerIndex = 1; playerIndex < clientsPerRoom; playerIndex++) {
    const client = await connectClient();
    clients.push(client);
    send(client, { type: 'join_room', code: created.code });
    await waitForMessage(client, message => message.type === 'room_joined');
    send(client, {
      type: 'player_name',
      playerIndex,
      name: `Load ${roomIndex + 1}-${playerIndex + 1}`,
    });
  }

  send(host, { type: 'player_name', playerIndex: 0, name: `Load ${roomIndex + 1}-1` });
  send(host, {
    type: 'start_game',
    mode: 'lobby',
    config,
    players: clients.map((_, playerIndex) => ({
      id: playerIndex,
      name: `Load ${roomIndex + 1}-${playerIndex + 1}`,
      isHuman: true,
    })),
  });
  const initialState = await waitForMessage(host, message => message.type === 'state_update' && message.state?.phase);
  const room = { code: created.code, clients, state: initialState.state };
  host.on('message', data => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'state_update' && message.state) room.state = message.state;
    } catch {}
  });
  return room;
}

function driveRoom(room) {
  const state = room.state;
  if (!state || state.phase !== 'playing') return;
  const waiting = state.waitingForClaim;
  if (waiting?.tile && Array.isArray(waiting.eligiblePlayers) && waiting.eligiblePlayers.length > 0) {
    const actor = waiting.eligiblePlayers[0].playerIndex;
    send(room.clients[actor], {
      type: 'action',
      actionType: 'pass_claim',
      clientActionId: `load-${++actionSequence}`,
      data: {},
    });
    stats.actions++;
    return;
  }
  const actor = state.currentPlayerIndex;
  const hand = state.players?.[actor]?.hand;
  if (!Number.isInteger(actor) || !Array.isArray(hand)) return;
  const tileIndex = hand.findIndex(tile => tile?.category !== 'fei' && tile?.category !== 'bonus');
  if (tileIndex < 0) return;
  send(room.clients[actor], {
    type: 'action',
    actionType: 'discard',
    clientActionId: `load-${++actionSequence}`,
    data: { tileIndex },
  });
  stats.actions++;
}

async function main() {
  if (shouldSpawn) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mahjong-load-'));
    child = spawn(process.execPath, ['server/index.cjs'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        ROOM_STATE_FILE: path.join(tempDir, 'rooms.json'),
        MAX_CONNECTIONS_PER_IP: String(roomCount * clientsPerRoom + 20),
        ROOM_CREATE_LIMIT: String(roomCount + 20),
        MAX_ROOMS: String(roomCount + 20),
        HEARTBEAT_INTERVAL_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
  }

  await waitForHealth();
  const setupStarted = Date.now();
  const rooms = [];
  for (let offset = 0; offset < roomCount; offset += 5) {
    const batch = Array.from(
      { length: Math.min(5, roomCount - offset) },
      (_, index) => createRoom(offset + index),
    );
    rooms.push(...await Promise.all(batch));
  }
  const setupMs = Date.now() - setupStarted;

  const actionTimer = setInterval(() => {
    rooms.forEach(driveRoom);
  }, 1200);
  await wait(durationMs);
  clearInterval(actionTimer);

  const health = await (await fetch(healthUrl)).json();
  closing = true;
  for (const room of rooms) {
    if (room.clients[0].readyState === WebSocket.OPEN) {
      send(room.clients[0], { type: 'quit_room' });
    }
  }
  await wait(200);
  for (const ws of sockets) ws.close();

  const result = {
    target: {
      rooms: roomCount,
      clients: roomCount * clientsPerRoom,
      durationMs,
    },
    setupMs,
    ...stats,
    health,
  };
  console.log(JSON.stringify(result, null, 2));

  if (stats.errors > 0 || stats.unexpectedCloses > 0 || stats.actionAcks < stats.actions) {
    throw new Error(`Load test failed with ${stats.errors} errors, ${stats.unexpectedCloses} unexpected closes, and ${stats.actionAcks}/${stats.actions} action acknowledgements`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    closing = true;
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {}
    }
    if (child) {
      child.kill('SIGTERM');
      await wait(300);
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });
