const mongoose = require('mongoose');
const { redisClient, isRedisConfigured } = require('../config/redis');

const API_VERSION = process.env.API_VERSION || 'v1';

/**
 * Heap usage ratio for memory.status (warning / critical thresholds).
 */
function memoryStatusFromRatio(ratio) {
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.85) return 'warning';
  return 'ok';
}

function buildMemorySnapshot(usage = process.memoryUsage()) {
  const heap_used_mb = Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
  const heap_total_mb = Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100;
  const rss_mb = Math.round((usage.rss / 1024 / 1024) * 100) / 100;
  const ratio = heap_total_mb > 0 ? heap_used_mb / heap_total_mb : 0;
  return {
    heap_used_mb,
    heap_total_mb,
    rss_mb,
    status: memoryStatusFromRatio(ratio),
  };
}

/**
 * DB ping; returns { status, ping_ms }.
 */
async function checkDatabase() {
  const start = Date.now();
  try {
    if (mongoose.connection.readyState !== 1) {
      return { status: 'error', ping_ms: 0 };
    }
    const db = mongoose.connection.db;
    if (!db || typeof db.admin !== 'function') {
      return { status: 'error', ping_ms: Date.now() - start };
    }
    await db.admin().command({ ping: 1 });
    const ping_ms = Date.now() - start;
    return { status: 'ok', ping_ms };
  } catch (e) {
    return { status: 'error', ping_ms: Math.max(0, Date.now() - start) };
  }
}

/**
 * Redis / cache; when not configured, treated as ok (app runs without cache).
 */
async function checkCache() {
  if (!isRedisConfigured()) {
    return { status: 'ok' };
  }
  try {
    if (typeof redisClient.ping === 'function') {
      await redisClient.ping();
    } else if (typeof redisClient.get === 'function') {
      await redisClient.get('__health_check__');
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error' };
  }
}

/**
 * Overall status: down = DB unreachable; degraded = slow DB, cache down, or memory warning/critical.
 */
function computeOverallStatus({ database, memory, cache }) {
  if (database.status === 'error') return 'down';
  let degraded = false;
  if (database.ping_ms > 100) degraded = true;
  if (cache.status === 'error') degraded = true;
  if (memory.status === 'warning' || memory.status === 'critical') degraded = true;
  if (degraded) return 'degraded';
  return 'ok';
}

function httpStatusForOverall(overall) {
  return overall === 'down' ? 503 : 200;
}

/**
 * Full system health payload (no secrets).
 * Uses module.exports for sub-checks so tests can jest.spyOn exports.
 */
async function buildSystemHealthSnapshot(deps = {}) {
  const memoryUsage = deps.memoryUsage || process.memoryUsage.bind(process);
  const [database, cache] = await Promise.all([
    deps.checkDatabase ? deps.checkDatabase() : module.exports.checkDatabase(),
    deps.checkCache ? deps.checkCache() : module.exports.checkCache(),
  ]);
  const memory = deps.buildMemorySnapshot
    ? deps.buildMemorySnapshot(memoryUsage())
    : module.exports.buildMemorySnapshot(memoryUsage());
  const overall = computeOverallStatus({ database, memory, cache });

  return {
    status: overall,
    version: API_VERSION.startsWith('v') ? API_VERSION : `v${API_VERSION}`,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    database,
    memory,
    cache,
    httpStatus: httpStatusForOverall(overall),
  };
}

module.exports = {
  buildSystemHealthSnapshot,
  buildMemorySnapshot,
  checkDatabase,
  checkCache,
  computeOverallStatus,
  memoryStatusFromRatio,
  httpStatusForOverall,
};
