const { monitorEventLoopDelay } = require('perf_hooks');

function createOperations() {
  const startedAt = Date.now();
  const cpuStartedAt = process.cpuUsage();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const counters = {
    connectionsAccepted: 0,
    connectionsRejected: 0,
    messagesReceived: 0,
    messagesRejected: 0,
    roomsCreated: 0,
    roomsDestroyed: 0,
    roomsRestored: 0,
    broadcasts: 0,
    bytesSent: 0,
    backpressureDisconnects: 0,
    rateLimited: 0,
  };

  function roomStats(rooms, wss) {
    const roomList = Object.values(rooms);
    return {
      rooms: roomList.length,
      startedRooms: roomList.filter(room => room.started).length,
      pausedRooms: roomList.filter(room => room.paused).length,
      connections: wss.clients.size,
    };
  }

  function snapshot(rooms, wss) {
    const memory = process.memoryUsage();
    const stats = roomStats(rooms, wss);
    const eventLoopP99Ms = Number((eventLoop.percentile(99) / 1e6).toFixed(2));
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const cpu = process.cpuUsage(cpuStartedAt);
    const cpuPercent = Number((((cpu.user + cpu.system) / 1000 / elapsedMs) * 100).toFixed(2));
    return {
      status: eventLoopP99Ms > 250 ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      ...stats,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      eventLoopP99Ms,
      cpuPercent,
      counters: { ...counters },
    };
  }

  function prometheus(rooms, wss) {
    const current = snapshot(rooms, wss);
    const lines = [
      '# TYPE sg_mahjong_rooms gauge',
      `sg_mahjong_rooms ${current.rooms}`,
      '# TYPE sg_mahjong_started_rooms gauge',
      `sg_mahjong_started_rooms ${current.startedRooms}`,
      '# TYPE sg_mahjong_paused_rooms gauge',
      `sg_mahjong_paused_rooms ${current.pausedRooms}`,
      '# TYPE sg_mahjong_connections gauge',
      `sg_mahjong_connections ${current.connections}`,
      '# TYPE sg_mahjong_memory_rss_bytes gauge',
      `sg_mahjong_memory_rss_bytes ${current.memory.rssBytes}`,
      '# TYPE sg_mahjong_memory_heap_used_bytes gauge',
      `sg_mahjong_memory_heap_used_bytes ${current.memory.heapUsedBytes}`,
      '# TYPE sg_mahjong_event_loop_p99_ms gauge',
      `sg_mahjong_event_loop_p99_ms ${current.eventLoopP99Ms}`,
      '# TYPE sg_mahjong_cpu_percent gauge',
      `sg_mahjong_cpu_percent ${current.cpuPercent}`,
    ];
    for (const [name, value] of Object.entries(current.counters)) {
      lines.push(`# TYPE sg_mahjong_${name} counter`);
      lines.push(`sg_mahjong_${name} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }

  function close() {
    eventLoop.disable();
  }

  return { counters, snapshot, prometheus, close };
}

module.exports = { createOperations };
