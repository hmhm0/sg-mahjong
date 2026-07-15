const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTsRuntime } = require('../server/ts-runtime.cjs');
const { RoomPersistence } = require('../server/roomPersistence.cjs');
const {
  ConnectionCounter,
  FixedWindowLimiter,
  createReconnectToken,
  createRoomCode,
  getClientIp,
  normalizeRoomCode,
  tokenMatches,
} = require('../server/security.cjs');

function testSharedEngineIsolation() {
  const runtime = createTsRuntime();
  const gameStore = runtime.load(path.resolve(__dirname, '../src/store/gameStore.ts'));
  assert.strictEqual(typeof gameStore.createGameStore, 'function');
  const first = gameStore.createGameStore();
  const second = gameStore.createGameStore();
  first.setState({ message: 'room one' });
  assert.strictEqual(first.getState().message, 'room one');
  assert.notStrictEqual(second.getState().message, 'room one');
}

function testReconnectTokens() {
  const token = createReconnectToken();
  assert.ok(token.length >= 40);
  assert.strictEqual(tokenMatches(token, token), true);
  assert.strictEqual(tokenMatches(token, createReconnectToken()), false);
  assert.strictEqual(tokenMatches('', token), false);
}

function testSecurityIdentityInputs() {
  const roomCode = createRoomCode();
  assert.strictEqual(normalizeRoomCode(roomCode), roomCode);

  const request = {
    headers: { 'x-forwarded-for': '203.0.113.50, 127.0.0.1' },
    socket: { remoteAddress: '198.51.100.20' },
  };
  assert.strictEqual(
    getClientIp(request),
    '198.51.100.20',
    'Direct clients must not spoof per-IP limits with X-Forwarded-For',
  );
  assert.strictEqual(
    getClientIp(request, true),
    '203.0.113.50',
    'A configured reverse proxy may supply the original client IP',
  );
}

function testLimitsAndCodes() {
  assert.strictEqual(normalizeRoomCode(' ab2z '), 'AB2Z');
  assert.strictEqual(normalizeRoomCode('IO01'), null);

  const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1000 });
  assert.strictEqual(limiter.consume('socket', 1, 0).allowed, true);
  assert.strictEqual(limiter.consume('socket', 1, 1).allowed, true);
  assert.strictEqual(limiter.consume('socket', 1, 2).allowed, false);
  assert.strictEqual(limiter.consume('socket', 1, 1001).allowed, true);

  const connections = new ConnectionCounter(2);
  assert.strictEqual(connections.acquire('ip'), true);
  assert.strictEqual(connections.acquire('ip'), true);
  assert.strictEqual(connections.acquire('ip'), false);
  connections.release('ip');
  assert.strictEqual(connections.acquire('ip'), true);
}

function testRoomPersistence() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mahjong-server-test-'));
  const filePath = path.join(tempDir, 'rooms.json');
  const persistence = new RoomPersistence(filePath, 1);
  const rooms = {
    ABCD: {
      code: 'ABCD',
      names: ['Host', 'Join', null, null],
      config: { taiThreshold: 4 },
      originalConfig: { taiThreshold: 4 },
      seed: 123,
      ready: [true, true, false, false],
      started: true,
      state: { phase: 'playing', players: [{ name: 'Host' }] },
      matchReady: null,
      seatTokens: Array.from({ length: 4 }, createReconnectToken),
      humanSeats: [true, true, false, false],
    },
  };
  persistence.flush(rooms);
  const restored = persistence.load();
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].code, 'ABCD');
  assert.strictEqual(restored[0].paused, true);
  assert.deepStrictEqual(restored[0].pauseReason, { type: 'server_restart' });
  assert.strictEqual(restored[0].seatTokens.length, 4);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

testSharedEngineIsolation();
testReconnectTokens();
testSecurityIdentityInputs();
testLimitsAndCodes();
testRoomPersistence();
console.log('Server smoke tests passed.');
