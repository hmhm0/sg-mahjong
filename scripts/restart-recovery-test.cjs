const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const port = Number.parseInt(process.env.RESTART_TEST_PORT || '3103', 10);
const serverUrl = `ws://127.0.0.1:${port}`;
const healthUrl = `http://127.0.0.1:${port}/health`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mahjong-restart-'));
const stateFile = path.join(tempDir, 'rooms.json');
let child = null;

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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return response.json();
    } catch {}
    await wait(100);
  }
  throw new Error('Restart test server did not become healthy');
}

function startServer() {
  child = spawn(process.execPath, ['server/index.cjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      ROOM_STATE_FILE: stateFile,
      RESTART_RECOVERY_TIMEOUT_MS: '30000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl);
    ws.queue = [];
    ws.waiters = [];
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      ws.queue.push(message);
      for (const waiter of [...ws.waiters]) {
        if (waiter.predicate(message)) {
          ws.waiters.splice(ws.waiters.indexOf(waiter), 1);
          clearTimeout(waiter.timeout);
          waiter.resolve(message);
        }
      }
    });
  });
}

function waitForMessage(ws, predicate) {
  const existing = ws.queue.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => reject(new Error('Timed out waiting for recovery message')), 10000),
    };
    ws.waiters.push(waiter);
  });
}

async function stopServer() {
  if (!child) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, wait(3000)]);
  child = null;
}

async function main() {
  startServer();
  await waitForHealth();
  const host = await connect();
  host.send(JSON.stringify({ type: 'create_room' }));
  const created = await waitForMessage(host, message => message.type === 'room_created');
  host.send(JSON.stringify({
    type: 'start_game',
    mode: 'lobby',
    config,
    players: [
      { id: 0, name: 'Recovery Host', isHuman: true },
      { id: 1, name: 'Sakura', isHuman: false },
      { id: 2, name: 'Mei Lin', isHuman: false },
      { id: 3, name: 'Kenji', isHuman: false },
    ],
  }));
  const before = await waitForMessage(host, message => message.type === 'state_update' && message.state?.phase);
  const beforeWallCount = before.state.wall.length;

  await stopServer();
  host.terminate();

  startServer();
  const restoredHealth = await waitForHealth();
  if (restoredHealth.counters.roomsRestored !== 1) {
    throw new Error(`Expected one restored room, received ${restoredHealth.counters.roomsRestored}`);
  }

  const intruder = await connect();
  intruder.send(JSON.stringify({
    type: 'rejoin_room',
    code: created.code,
    playerIndex: 0,
    reconnectToken: 'invalid-token',
  }));
  const rejected = await waitForMessage(intruder, message => message.type === 'error');
  if (rejected.message !== 'Invalid reconnect credentials') {
    throw new Error('A rejoin attempt with the wrong seat token was not rejected');
  }
  intruder.close();

  const rejoinedHost = await connect();
  rejoinedHost.send(JSON.stringify({
    type: 'rejoin_room',
    code: created.code,
    playerIndex: 0,
    reconnectToken: created.reconnectToken,
  }));
  await waitForMessage(rejoinedHost, message => message.type === 'room_joined');
  const after = await waitForMessage(rejoinedHost, message => message.type === 'state_update');
  if (after.state.phase !== before.state.phase || after.state.wall.length !== beforeWallCount) {
    throw new Error('Restored canonical room state does not match the pre-restart state');
  }
  await waitForMessage(rejoinedHost, message => message.type === 'room_resumed');
  rejoinedHost.send(JSON.stringify({ type: 'quit_room' }));
  rejoinedHost.close();

  console.log(JSON.stringify({
    roomCode: created.code,
    restoredRooms: restoredHealth.counters.roomsRestored,
    phase: after.state.phase,
    wallCount: after.state.wall.length,
    secureRejoin: true,
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
