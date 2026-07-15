const crypto = require('crypto');

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createReconnectToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 4; index++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeRoomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-HJ-NP-Z2-9]{4}$/.test(code) ? code : null;
}

function getClientIp(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = request?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  return request?.socket?.remoteAddress || 'unknown';
}

class FixedWindowLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  consume(key, amount = 1, now = Date.now()) {
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: amount, resetAt: now + this.windowMs });
      return { allowed: amount <= this.limit, remaining: Math.max(0, this.limit - amount) };
    }
    current.count += amount;
    return {
      allowed: current.count <= this.limit,
      remaining: Math.max(0, this.limit - current.count),
      retryAfterMs: Math.max(0, current.resetAt - now),
    };
  }

  cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

class ConnectionCounter {
  constructor(limit) {
    this.limit = limit;
    this.counts = new Map();
  }

  acquire(key) {
    const count = this.counts.get(key) || 0;
    if (count >= this.limit) return false;
    this.counts.set(key, count + 1);
    return true;
  }

  release(key) {
    const count = this.counts.get(key) || 0;
    if (count <= 1) this.counts.delete(key);
    else this.counts.set(key, count - 1);
  }
}

module.exports = {
  ConnectionCounter,
  FixedWindowLimiter,
  createReconnectToken,
  createRoomCode,
  getClientIp,
  normalizeRoomCode,
  readPositiveInteger,
  tokenMatches,
};
