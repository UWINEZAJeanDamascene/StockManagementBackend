/**
 * Redis-backed rate limiter (in-memory mock for Redis commands used)
 */

global.__rateLimitRedisStore = {
  counts: new Map(),
  expiries: new Map(),
};

global.__rlClearIfExpired = function __rlClearIfExpired(key) {
  const s = global.__rateLimitRedisStore;
  const exp = s.expiries.get(key);
  if (exp != null && Date.now() >= exp) {
    s.counts.delete(key);
    s.expiries.delete(key);
  }
};

jest.mock('../../../config/redis', () => ({
  redisClient: {
    incr: async (key) => {
      const s = global.__rateLimitRedisStore;
      global.__rlClearIfExpired(key);
      const next = (s.counts.get(key) || 0) + 1;
      s.counts.set(key, next);
      return next;
    },
    expire: async (key, seconds) => {
      const s = global.__rateLimitRedisStore;
      s.expiries.set(key, Date.now() + seconds * 1000);
    },
    ttl: async (key) => {
      const s = global.__rateLimitRedisStore;
      global.__rlClearIfExpired(key);
      const exp = s.expiries.get(key);
      if (!exp) return -1;
      const left = Math.ceil((exp - Date.now()) / 1000);
      return left > 0 ? left : -2;
    },
    del: async (key) => {
      const s = global.__rateLimitRedisStore;
      s.counts.delete(key);
      s.expiries.delete(key);
    },
  },
}));

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { createRateLimiter, createRateLimiters } = require('../../../middleware/redisRateLimiter');

function resetRedisMock() {
  global.__rateLimitRedisStore.counts.clear();
  global.__rateLimitRedisStore.expiries.clear();
}

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetRedisMock();
    jest.useRealTimers();
  });

  it('blocks request after 10 auth attempts within 15 minutes', async () => {
    const { auth } = createRateLimiters();
    const app = express();
    app.use(express.json());
    app.post('/auth/login', auth, (req, res) => res.status(200).json({ ok: true }));

    const body = { email: 'user@test.com', password: 'x' };
    for (let i = 0; i < 10; i++) {
      await request(app).post('/auth/login').send(body).expect(200);
    }
    await request(app).post('/auth/login').send(body).expect(429);
  });

  it('returns 429 with RATE_LIMIT_EXCEEDED code', async () => {
    const { auth } = createRateLimiters();
    const app = express();
    app.use(express.json());
    app.post('/auth/login', auth, (req, res) => res.json({ ok: true }));

    const body = { email: 'a@b.com', password: 'p' };
    for (let i = 0; i < 10; i++) {
      await request(app).post('/auth/login').send(body);
    }
    const res = await request(app).post('/auth/login').send(body).expect(429);
    expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.body.success).toBe(false);
  });

  it('includes retry_after in response', async () => {
    const { auth } = createRateLimiters();
    const app = express();
    app.use(express.json());
    app.post('/auth/login', auth, (req, res) => res.json({ ok: true }));

    const body = { email: 'retry@test.com', password: 'p' };
    for (let i = 0; i < 10; i++) {
      await request(app).post('/auth/login').send(body);
    }
    const res = await request(app).post('/auth/login').send(body).expect(429);
    expect(res.body).toHaveProperty('retry_after');
    expect(typeof res.body.retry_after).toBe('number');
    expect(res.body.retry_after).toBeGreaterThanOrEqual(0);
  });

  it('resets counter after window expires', async () => {
    jest.useFakeTimers({ now: 0 });

    const shortAuth = createRateLimiter({
      windowMs: 500,
      max: 2,
      keyPrefix: 'ratelimit:auth_short',
      keyGenerator: (req) => {
        const ip = req.ip || 'unknown';
        const email =
          req.body && typeof req.body.email === 'string'
            ? req.body.email.toLowerCase().trim()
            : '';
        return `${ip}:${email}`;
      },
      handler: (req, res, meta = {}) => {
        res.status(429).json({
          success: false,
          code: 'RATE_LIMIT_EXCEEDED',
          retry_after: meta.retryAfter ?? 0,
        });
      },
    });

    const app = express();
    app.use(express.json());
    app.post('/login', shortAuth, (req, res) => res.json({ ok: true }));

    const body = { email: 'window@test.com', password: 'p' };
    await request(app).post('/login').send(body).expect(200);
    await request(app).post('/login').send(body).expect(200);
    await request(app).post('/login').send(body).expect(429);

    // windowMs 500 → Redis TTL is ceil(500/1000)=1s; advance past expiry so counter resets
    jest.advanceTimersByTime(1500);

    await request(app).post('/login').send(body).expect(200);
    jest.useRealTimers();
  });

  it('auth limiter keys by IP + email combination', async () => {
    const { auth } = createRateLimiters();
    const app = express();
    app.use(express.json());
    app.post('/auth/login', auth, (req, res) => res.json({ ok: true }));

    const emailA = { email: 'alice@test.com', password: 'p' };
    const emailB = { email: 'bob@test.com', password: 'p' };

    for (let i = 0; i < 10; i++) {
      await request(app).post('/auth/login').send(emailA).expect(200);
    }
    await request(app).post('/auth/login').send(emailA).expect(429);

    await request(app).post('/auth/login').send(emailB).expect(200);
  });

  it('company limiter keys by company_id not IP', async () => {
    const companyLimiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'ratelimit:company',
      limitBy: 'company',
    });

    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();

    const app = express();
    app.use((req, res, next) => {
      const which = req.headers['x-test-company'];
      req.company = { _id: which === 'b' ? idB : idA };
      next();
    });
    app.get('/api/x', companyLimiter, (req, res) => res.json({ company: req.company._id.toString() }));

    await request(app).get('/api/x').set('x-test-company', 'a').expect(200);
    await request(app).get('/api/x').set('x-test-company', 'a').expect(200);
    await request(app).get('/api/x').set('x-test-company', 'a').expect(429);

    await request(app).get('/api/x').set('x-test-company', 'b').expect(200);
  });
});
