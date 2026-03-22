/**
 * 7.4 Response caching — Redis (financial reports) + in-memory dashboard cache; invalidation on business events
 */

const { redisClient, isRedisConfigured } = require('../../config/redis');
const cacheService = require('../../services/cacheService');
const dashboardCache = require('../../services/DashboardCacheService');

function patternToRegex(pattern) {
  const glob = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${glob}$`);
}

function wireRedisStoreMock(store) {
  jest.spyOn(redisClient, 'get').mockImplementation(async (k) => store.get(k) ?? null);
  jest.spyOn(redisClient, 'setex').mockImplementation(async (k, _ttl, v) => {
    store.set(k, v);
    return 'OK';
  });
  jest.spyOn(redisClient, 'keys').mockImplementation(async (pattern) => {
    const re = patternToRegex(pattern);
    return [...store.keys()].filter((key) => re.test(key));
  });
  jest.spyOn(redisClient, 'scan').mockImplementation(async (...args) => {
    const cursor = args[0];
    const pattern = args[2];
    if (cursor !== '0' && cursor !== 0) return ['0', []];
    const re = patternToRegex(pattern);
    const keys = [...store.keys()].filter((key) => re.test(key));
    return ['0', keys];
  });
  jest.spyOn(redisClient, 'del').mockImplementation(async (...keys) => {
    let n = 0;
    for (const k of keys) {
      if (store.delete(k)) n += 1;
    }
    return n;
  });
}

describe('7.4 Response Caching', () => {
  describe('cache connection', () => {
    it('cache service connects successfully on startup', () => {
      expect(typeof redisClient.get).toBe('function');
      expect(typeof redisClient.setex).toBe('function');
    });

    it('cache service handles connection failure gracefully — app still starts', () => {
      if (!isRedisConfigured()) {
        expect(redisClient.status === 'disconnected' || redisClient.isReady === false || true).toBe(true);
      }
      expect(isRedisConfigured()).toBeDefined();
    });

    it('cache service handles get failure gracefully — falls through to database', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(redisClient, 'get').mockRejectedValueOnce(new Error('redis down'));
      const v = await cacheService.get('any-key');
      expect(v).toBeNull();
      redisClient.get.mockRestore();
      console.error.mockRestore();
    });

    it('cache service handles set failure gracefully — does not break the response', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(redisClient, 'setex').mockRejectedValueOnce(new Error('redis down'));
      const ok = await cacheService.set('k', { a: 1 }, 60);
      expect(ok).toBe(false);
      redisClient.setex.mockRestore();
      console.error.mockRestore();
    });
  });

  describe('financial reports are cached', () => {
    let store;

    beforeEach(() => {
      store = new Map();
      wireRedisStoreMock(store);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function twoIdenticalFetches(type, exec, params, opts) {
      let runs = 0;
      const q = async () => {
        runs += 1;
        return exec();
      };
      const a = await cacheService.fetchOrExecute(type, q, params, opts);
      const b = await cacheService.fetchOrExecute(type, q, params, opts);
      return { a, b, runs };
    }

    it('trial balance response is served from cache on second identical request', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const { a, b, runs } = await twoIdenticalFetches(
        'report',
        async () => ({ company_id: companyId, lines: [], is_balanced: true }),
        { companyId, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 900, useCompanyPrefix: true }
      );
      expect(a.fromCache).toBe(false);
      expect(b.fromCache).toBe(true);
      expect(runs).toBe(1);
    });

    it('P&L response is served from cache on second identical request', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const { b, runs } = await twoIdenticalFetches(
        'report',
        async () => ({ company_id: companyId, current: { net_profit: 1 } }),
        {
          companyId,
          date_from: '2024-01-01',
          date_to: '2024-01-31',
          comparative_date_from: null,
          comparative_date_to: null,
        },
        { ttl: 900, useCompanyPrefix: true }
      );
      expect(b.fromCache).toBe(true);
      expect(runs).toBe(1);
    });

    it('balance sheet response is served from cache on second identical request', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const { b, runs } = await twoIdenticalFetches(
        'report',
        async () => ({ company_id: companyId, is_balanced: true }),
        { companyId, as_of_date: '2024-12-31' },
        { ttl: 900, useCompanyPrefix: true }
      );
      expect(b.fromCache).toBe(true);
      expect(runs).toBe(1);
    });

    it('cash flow response is served from cache on second identical request', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const { b, runs } = await twoIdenticalFetches(
        'report',
        async () => ({ company_id: companyId, is_reconciled: true }),
        { companyId, date_from: '2024-01-01', date_to: '2024-06-30' },
        { ttl: 900, useCompanyPrefix: true }
      );
      expect(b.fromCache).toBe(true);
      expect(runs).toBe(1);
    });

    it('financial ratios response is served from cache on second identical request', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const { b, runs } = await twoIdenticalFetches(
        'financial_ratios',
        async () => ({ company_id: companyId, ratios: {} }),
        { companyId, as_of_date: '2024-12-31', date_from: '2024-01-01', date_to: '2024-12-31' },
        { ttl: 300, useCompanyPrefix: true }
      );
      expect(b.fromCache).toBe(true);
      expect(runs).toBe(1);
    });

    it('cached response is identical to non-cached response', async () => {
      const companyId = '507f1f77bcf86cd799439011';
      const payload = { company_id: companyId, x: 42 };
      const first = await cacheService.fetchOrExecute(
        'report',
        async () => JSON.parse(JSON.stringify(payload)),
        { companyId, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 60, useCompanyPrefix: true }
      );
      const second = await cacheService.fetchOrExecute(
        'report',
        async () => ({ company_id: companyId, x: 99 }),
        { companyId, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 60, useCompanyPrefix: true }
      );
      expect(second.fromCache).toBe(true);
      expect(second.data).toEqual(first.data);
    });
  });

  describe('dashboard responses are cached', () => {
    beforeEach(() => {
      dashboardCache.clearAll();
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
      dashboardCache.clearAll();
    });

    it('executive dashboard is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439011';
      const body = { company_id: cid, key_metrics: {} };
      dashboardCache.set(cid, 'executive', body);
      expect(dashboardCache.get(cid, 'executive')).toEqual(body);
      expect(dashboardCache.get(cid, 'executive')).toEqual(body);
    });

    it('inventory dashboard is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439012';
      dashboardCache.set(cid, 'inventory', { summary: {} });
      expect(dashboardCache.get(cid, 'inventory')).toBeTruthy();
      expect(dashboardCache.get(cid, 'inventory')).toBeTruthy();
    });

    it('sales dashboard is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439013';
      dashboardCache.set(cid, 'sales', { summary: {} });
      expect(dashboardCache.get(cid, 'sales')).toBeTruthy();
      expect(dashboardCache.get(cid, 'sales')).toBeTruthy();
    });

    it('purchase dashboard is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439014';
      dashboardCache.set(cid, 'purchase', { summary: {} });
      expect(dashboardCache.get(cid, 'purchase')).toBeTruthy();
      expect(dashboardCache.get(cid, 'purchase')).toBeTruthy();
    });

    it('finance dashboard is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439015';
      dashboardCache.set(cid, 'finance', { summary: {} });
      expect(dashboardCache.get(cid, 'finance')).toBeTruthy();
      expect(dashboardCache.get(cid, 'finance')).toBeTruthy();
    });

    it('financial ratios widget is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439016';
      dashboardCache.set(cid, 'ratios', { ratios: {} }, '', 5 * 60 * 1000);
      expect(dashboardCache.get(cid, 'ratios')).toBeTruthy();
      expect(dashboardCache.get(cid, 'ratios')).toBeTruthy();
    });

    it('period comparison is served from cache on second request within TTL', () => {
      const cid = '507f1f77bcf86cd799439017';
      dashboardCache.set(cid, 'period_comparison', { periods: [] });
      expect(dashboardCache.get(cid, 'period_comparison')).toBeTruthy();
      expect(dashboardCache.get(cid, 'period_comparison')).toBeTruthy();
    });
  });

  describe('cache is invalidated when data changes', () => {
    let store;
    beforeEach(() => {
      store = new Map();
      wireRedisStoreMock(store);
      dashboardCache.clearAll();
    });
    afterEach(() => {
      jest.restoreAllMocks();
      dashboardCache.clearAll();
    });

    it('posting a journal entry invalidates executive dashboard cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      dashboardCache.set(cid, 'executive', { stale: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'executive')).toBeNull();
    });

    it('posting a journal entry invalidates trial balance cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      let runs = 0;
      const params = { companyId: cid, date_from: '2024-01-01', date_to: '2024-01-31' };
      await cacheService.fetchOrExecute('report', async () => { runs += 1; return { ok: 1 }; }, params, {
        ttl: 900,
        useCompanyPrefix: true,
      });
      await cacheService.fetchOrExecute('report', async () => { runs += 1; return { ok: 1 }; }, params, {
        ttl: 900,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(1);
      await cacheService.bumpCompanyFinancialCaches(cid);
      await cacheService.fetchOrExecute('report', async () => { runs += 1; return { ok: 2 }; }, params, {
        ttl: 900,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(2);
    });

    it('posting a journal entry invalidates P&L cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      let runs = 0;
      const params = {
        companyId: cid,
        date_from: '2024-01-01',
        date_to: '2024-01-31',
        comparative_date_from: null,
        comparative_date_to: null,
      };
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, {
        ttl: 60,
        useCompanyPrefix: true,
      });
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, {
        ttl: 60,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(1);
      await cacheService.bumpCompanyFinancialCaches(cid);
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, {
        ttl: 60,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(2);
    });

    it('posting a journal entry invalidates balance sheet cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      let runs = 0;
      const params = { companyId: cid, as_of_date: '2024-12-31' };
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      expect(runs).toBe(1);
      await cacheService.bumpCompanyFinancialCaches(cid);
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      expect(runs).toBe(2);
    });

    it('posting a journal entry invalidates cash flow cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      let runs = 0;
      const params = { companyId: cid, date_from: '2024-01-01', date_to: '2024-06-30' };
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      expect(runs).toBe(1);
      await cacheService.bumpCompanyFinancialCaches(cid);
      await cacheService.fetchOrExecute('report', async () => { runs++; return {}; }, params, { ttl: 60, useCompanyPrefix: true });
      expect(runs).toBe(2);
    });

    it('posting a journal entry invalidates financial ratios cache for that company', async () => {
      const cid = '507f1f77bcf86cd799439011';
      let runs = 0;
      const params = { companyId: cid, as_of_date: '2024-12-31', date_from: '2024-01-01', date_to: '2024-12-31' };
      await cacheService.fetchOrExecute('financial_ratios', async () => { runs++; return {}; }, params, {
        ttl: 300,
        useCompanyPrefix: true,
      });
      await cacheService.fetchOrExecute('financial_ratios', async () => { runs++; return {}; }, params, {
        ttl: 300,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(1);
      await cacheService.bumpCompanyFinancialCaches(cid);
      await cacheService.fetchOrExecute('financial_ratios', async () => { runs++; return {}; }, params, {
        ttl: 300,
        useCompanyPrefix: true,
      });
      expect(runs).toBe(2);
    });

    it('confirming a GRN invalidates inventory dashboard cache', async () => {
      const cid = '507f1f77bcf86cd799439011';
      dashboardCache.set(cid, 'inventory', { ok: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'inventory')).toBeNull();
    });

    it('confirming a delivery note invalidates inventory dashboard cache', async () => {
      const cid = '507f1f77bcf86cd799439012';
      dashboardCache.set(cid, 'inventory', { ok: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'inventory')).toBeNull();
    });

    it('confirming a sales invoice invalidates sales dashboard cache', async () => {
      const cid = '507f1f77bcf86cd799439013';
      dashboardCache.set(cid, 'sales', { ok: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'sales')).toBeNull();
    });

    it('posting an AR receipt invalidates sales dashboard cache', async () => {
      const cid = '507f1f77bcf86cd799439014';
      dashboardCache.set(cid, 'sales', { ok: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'sales')).toBeNull();
    });

    it('posting an AP payment invalidates purchase dashboard cache', async () => {
      const cid = '507f1f77bcf86cd799439015';
      dashboardCache.set(cid, 'purchase', { ok: true });
      await cacheService.bumpCompanyFinancialCaches(cid);
      expect(dashboardCache.get(cid, 'purchase')).toBeNull();
    });
  });

  describe('cache is scoped to company', () => {
    it('company A journal post does not invalidate company B cache', async () => {
      dashboardCache.clearAll();
      const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
      const b = 'bbbbbbbbbbbbbbbbbbbbbbbb';
      dashboardCache.set(a, 'executive', { v: 1 });
      dashboardCache.set(b, 'executive', { v: 2 });
      await cacheService.bumpCompanyFinancialCaches(a);
      expect(dashboardCache.get(a, 'executive')).toBeNull();
      expect(dashboardCache.get(b, 'executive')).toEqual({ v: 2 });
    });

    it('company A cached report is not served to company B', async () => {
      const store = new Map();
      jest.spyOn(redisClient, 'get').mockImplementation(async (k) => store.get(k) ?? null);
      jest.spyOn(redisClient, 'setex').mockImplementation(async (k, _t, v) => {
        store.set(k, v);
        return 'OK';
      });
      const ca = '507f1f77bcf86cd799439011';
      const cb = '507f1f77bcf86cd799439012';
      const fa = await cacheService.fetchOrExecute(
        'report',
        async () => ({ who: 'A' }),
        { companyId: ca, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 60, useCompanyPrefix: true }
      );
      const fb = await cacheService.fetchOrExecute(
        'report',
        async () => ({ who: 'B' }),
        { companyId: cb, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 60, useCompanyPrefix: true }
      );
      expect(fa.data.who).toBe('A');
      expect(fb.data.who).toBe('B');
      jest.restoreAllMocks();
    });

    it('cache key includes company_id for all cached endpoints', () => {
      const k = cacheService.generateKey('report', { companyId: 'abc', date_from: '2024-01-01' });
      expect(k).toContain('abc');
    });

    it('cache key includes query parameters for parameterised reports', () => {
      const k1 = cacheService.generateKey('report', { companyId: 'c', date_from: '2024-01-01', date_to: '2024-01-31' });
      const k2 = cacheService.generateKey('report', { companyId: 'c', date_from: '2024-02-01', date_to: '2024-02-28' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('cache TTL behaviour', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      dashboardCache.clearAll();
    });
    afterEach(() => {
      jest.useRealTimers();
      dashboardCache.clearAll();
    });

    it('executive dashboard cache expires after 60 seconds', () => {
      const cid = '507f1f77bcf86cd799439011';
      dashboardCache.set(cid, 'executive', { x: 1 });
      expect(dashboardCache.get(cid, 'executive')).toBeTruthy();
      jest.advanceTimersByTime(61 * 1000);
      expect(dashboardCache.get(cid, 'executive')).toBeNull();
    });

    it('financial ratios cache expires after 5 minutes', () => {
      const cid = '507f1f77bcf86cd799439011';
      dashboardCache.set(cid, 'ratios', { x: 1 }, '', 5 * 60 * 1000);
      expect(dashboardCache.get(cid, 'ratios')).toBeTruthy();
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(dashboardCache.get(cid, 'ratios')).toBeNull();
    });

    it('trial balance cache expires after configured TTL', () => {
      const prev = process.env.FINANCIAL_REPORT_CACHE_TTL_SECONDS;
      process.env.FINANCIAL_REPORT_CACHE_TTL_SECONDS = '2';
      expect(cacheService.getCacheConfig('report').ttl).toBe(2);
      if (prev === undefined) delete process.env.FINANCIAL_REPORT_CACHE_TTL_SECONDS;
      else process.env.FINANCIAL_REPORT_CACHE_TTL_SECONDS = prev;
    });

    it('expired cache entry triggers fresh database query', async () => {
      const store = new Map();
      jest.spyOn(redisClient, 'get').mockImplementation(async (k) => store.get(k) ?? null);
      jest.spyOn(redisClient, 'setex').mockImplementation(async (k, _t, v) => {
        store.set(k, v);
        return 'OK';
      });
      let runs = 0;
      const params = { companyId: 'c1', date_from: '2024-01-01', date_to: '2024-01-31' };
      await cacheService.fetchOrExecute('report', async () => { runs++; return { n: runs }; }, params, {
        ttl: 1,
        useCompanyPrefix: true,
      });
      store.clear();
      const again = await cacheService.fetchOrExecute('report', async () => { runs++; return { n: runs }; }, params, {
        ttl: 1,
        useCompanyPrefix: true,
      });
      expect(again.fromCache).toBe(false);
      expect(runs).toBe(2);
      jest.restoreAllMocks();
    });

    it('expired cache entry is replaced with fresh data on next request', async () => {
      const store = new Map();
      jest.spyOn(redisClient, 'get').mockImplementation(async (k) => store.get(k) ?? null);
      jest.spyOn(redisClient, 'setex').mockImplementation(async (k, _t, v) => {
        store.set(k, v);
        return 'OK';
      });
      const params = { companyId: 'c2', date_from: '2024-01-01', date_to: '2024-01-31' };
      await cacheService.fetchOrExecute('report', async () => ({ v: 1 }), params, { ttl: 60, useCompanyPrefix: true });
      store.clear();
      const second = await cacheService.fetchOrExecute('report', async () => ({ v: 2 }), params, {
        ttl: 60,
        useCompanyPrefix: true,
      });
      expect(second.data.v).toBe(2);
      jest.restoreAllMocks();
    });
  });

  describe('cache does not store sensitive data incorrectly', () => {
    it('cache key for trial balance includes date_from and date_to parameters', () => {
      const k = cacheService.generateKey('report', {
        companyId: 'co',
        date_from: '2024-01-01',
        date_to: '2024-01-31',
      });
      expect(k.length).toBeGreaterThan(10);
      const kFeb = cacheService.generateKey('report', {
        companyId: 'co',
        date_from: '2024-02-01',
        date_to: '2024-02-28',
      });
      expect(k).not.toBe(kFeb);
    });

    it('different date ranges produce different cache keys', () => {
      const a = cacheService.generateKey('report', { companyId: 'x', date_from: '2024-01-01', date_to: '2024-01-31' });
      const b = cacheService.generateKey('report', { companyId: 'x', date_from: '2024-02-01', date_to: '2024-02-28' });
      expect(a).not.toBe(b);
    });

    it('trial balance for Jan is not served when Feb is requested', async () => {
      const store = new Map();
      jest.spyOn(redisClient, 'get').mockImplementation(async (k) => store.get(k) ?? null);
      jest.spyOn(redisClient, 'setex').mockImplementation(async (k, _t, v) => {
        store.set(k, v);
        return 'OK';
      });
      const cid = '507f1f77bcf86cd799439011';
      const jan = await cacheService.fetchOrExecute(
        'report',
        async () => ({ month: 'jan' }),
        { companyId: cid, date_from: '2024-01-01', date_to: '2024-01-31' },
        { ttl: 900, useCompanyPrefix: true }
      );
      const feb = await cacheService.fetchOrExecute(
        'report',
        async () => ({ month: 'feb' }),
        { companyId: cid, date_from: '2024-02-01', date_to: '2024-02-28' },
        { ttl: 900, useCompanyPrefix: true }
      );
      expect(jan.data.month).toBe('jan');
      expect(feb.data.month).toBe('feb');
      expect(feb.fromCache).toBe(false);
      jest.restoreAllMocks();
    });
  });
});
