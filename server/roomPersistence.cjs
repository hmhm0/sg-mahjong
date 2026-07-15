const fs = require('fs');
const path = require('path');

const ROOM_SNAPSHOT_VERSION = 1;

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function serializeRoom(room) {
  const state = cloneSerializable(room.state);
  if (state) state.debugLogs = [];
  return {
    code: room.code,
    names: [...room.names],
    config: cloneSerializable(room.config),
    originalConfig: cloneSerializable(room.originalConfig),
    seed: room.seed,
    ready: [...room.ready],
    started: Boolean(room.started),
    state,
    paused: true,
    pauseReason: { type: 'server_restart' },
    matchReady: Array.isArray(room.matchReady) ? [...room.matchReady] : null,
    rematchCountdown: null,
    seatTokens: [...room.seatTokens],
    humanSeats: Array.isArray(room.humanSeats) ? [...room.humanSeats] : [true, false, false, false],
    stateRevision: Number.isInteger(room.stateRevision) ? room.stateRevision : 0,
    updatedAt: Date.now(),
  };
}

class RoomPersistence {
  constructor(filePath, debounceMs = 1000) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.pendingRooms = null;
  }

  schedule(rooms) {
    this.pendingRooms = rooms;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  flush(rooms = this.pendingRooms) {
    this.pendingRooms = rooms;
    if (!rooms) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const payload = {
      version: ROOM_SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      rooms: Object.values(rooms).map(serializeRoom),
    };
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    this.pendingRooms = null;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.version !== ROOM_SNAPSHOT_VERSION || !Array.isArray(parsed.rooms)) return [];
      return parsed.rooms.filter(room =>
        typeof room?.code === 'string' &&
        Array.isArray(room?.seatTokens) &&
        room.seatTokens.length === 4
      );
    } catch (error) {
      console.error(`Failed to restore room snapshots from ${this.filePath}:`, error);
      return [];
    }
  }

  close(rooms) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush(rooms);
  }
}

module.exports = {
  RoomPersistence,
  serializeRoom,
};
