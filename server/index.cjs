const { WebSocketServer } = require('ws');

const PORT = 3002;
const wss = new WebSocketServer({ port: PORT });

const EMPTY_ROOM_TIMEOUT_MS = 10 * 60 * 1000;
const rooms = {}; // code -> { host: ws, players: [ws|null*4], config: null, seed: null, ready: boolean[], started: boolean, emptyRoomTimer: Timeout|null }

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

function clearEmptyRoomTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.emptyRoomTimer) return;
  clearTimeout(room.emptyRoomTimer);
  room.emptyRoomTimer = null;
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
    delete rooms[roomCode];
  }, EMPTY_ROOM_TIMEOUT_MS);
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
            players: [null, null, null, null],
            config: null,
            seed: null,
            ready: [false, false, false, false],
            started: false,
            emptyRoomTimer: null,
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

          const freeSlot = room.players.findIndex(p => p === null);
          if (freeSlot === -1) return send(ws, { type: 'error', message: 'Room is full' });

          room.players[freeSlot] = ws;
          clearEmptyRoomTimer(msg.code);
          currentRoom = msg.code;
          playerIndex = freeSlot;

          send(ws, { type: 'room_joined', code: msg.code, playerIndex: freeSlot + 1 });
          broadcast(msg.code, { type: 'player_joined', playerIndex: freeSlot + 1 });

          // Check if room is now full
          if (room.players.every(p => p !== null)) {
            broadcast(msg.code, { type: 'room_full' });
          }
          break;
        }

        case 'start_game': {
          if (!currentRoom || playerIndex !== 0) return;
          const room = rooms[currentRoom];
          if (!room) return;

          room.config = msg.config;
          room.seed = Math.floor(Math.random() * 2147483647);
          room.started = true;
          clearEmptyRoomTimer(currentRoom);

          const playerCount = room.players.filter(p => p !== null).length + 1; // +1 for host

          broadcast(currentRoom, {
            type: 'game_started',
            config: room.config,
            seed: room.seed,
            playerCount,
            hostIndex: 0,
          });
          break;
        }

       case 'action': {
         if (!currentRoom) return;
          // Route action to host (playerIndex 0) for processing
          const room = rooms[currentRoom];
          if (room && room.host && room.host !== ws && room.host.readyState === 1) {
            // Extract playerIndex from the message (top-level or inside data)
            const remotePlayerIndex = msg.playerIndex !== undefined ? msg.playerIndex : (msg.data?.playerIdx ?? -1);
            room.host.send(JSON.stringify({
              type: 'player_action',
              playerIndex: remotePlayerIndex,
              actionType: msg.actionType,
              data: msg.data,
            }));
          }
          break;
        }

        case 'state_update': {
          if (!currentRoom || playerIndex !== 0) return;
          // Host broadcasts full game state to all other clients
          broadcast(currentRoom, {
            type: 'state_update',
            state: msg.state,
          }, ws);
          break;
        }

        case 'leave_room': {
          if (currentRoom) {
            // cleanupRoom handles the player_left broadcast
            cleanupRoom(currentRoom, ws);
          }
          break;
       }

        case 'dice_results': {
          if (!currentRoom || playerIndex !== 0) return;
          // Host broadcasts dice results to all other clients
          broadcast(currentRoom, {
            type: 'dice_results',
            dice: msg.dice,
            totals: msg.totals,
            eastPlayerIdx: msg.eastPlayerIdx,
            playerCount: msg.playerCount,
            myPlayerIndex: msg.myPlayerIndex,
          }, ws);
          break;
        }

        case 'player_ready': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room) return;
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
          playerIndex = msg.playerIndex;
          room2.players[playerIndex - 1] = ws;
          clearEmptyRoomTimer(msg.code);
          currentRoom = msg.code;
          send(ws, { type: 'room_joined', code: msg.code, playerIndex: msg.playerIndex });
          broadcast(msg.code, { type: 'player_joined', playerIndex: msg.playerIndex });
          break;
        }

        case 'player_name': {
          if (!currentRoom) return;
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
    // Host disconnected - close the room
    clearEmptyRoomTimer(code);
    broadcast(code, { type: 'room_closed' });
    delete rooms[code];
  } else {
    const idx = room.players.indexOf(ws);
    if (idx !== -1) {
      room.players[idx] = null;
      broadcast(code, { type: 'player_left', playerIndex: idx + 1 });
      scheduleEmptyRoomTimer(code);
    }
  }
}

console.log(`Mahjong server running on ws://localhost:${PORT}`);
