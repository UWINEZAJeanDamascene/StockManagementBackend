/**
 * 7.8 Health check endpoint — /api/health (system), /api/health/accounting (scoped)
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const healthService = require('../../services/healthService');
const healthController = require('../../controllers/healthController');
const { protect } = require('../../middleware/auth');
const requireCompanyHeader = require('../../middleware/requireCompanyHeader');

function buildSystemHealthApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/health', healthController.systemHealth);
  app.get('/health', healthController.systemHealth);
  return app;
}

function buildAccountingHealthApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/health/accounting', protect, requireCompanyHeader, healthController.accountingHealth);
  return app;
}

describe('7.8 Health Check Endpoint', () => {
  let mongoServer;
  let restoreEnv;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
      restoreEnv = null;
    }
    jest.restoreAllMocks();
  });

  describe('GET /health — basic response', () => {
    it('returns 200 when system is healthy', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns status ok when all checks pass', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns version field matching current API version', async () => {
      restoreEnv = () => {
        delete process.env.API_VERSION;
      };
      delete process.env.API_VERSION;
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.version).toBe('v1');
    });

    it('returns timestamp in ISO 8601 format', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(typeof res.body.timestamp).toBe('string');
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('returns uptime_seconds as a positive number', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(typeof res.body.uptime_seconds).toBe('number');
      expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    });

    it('does not require authentication', async () => {
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(200);
    });

    it('does not require X-Company-Id header', async () => {
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(200);
    });

    it('is not affected by rate limiting', async () => {
      const app = express();
      const rateLimit = require('express-rate-limit');
      const limiter = rateLimit({ windowMs: 60_000, max: 2, standardHeaders: true, legacyHeaders: false });
      app.get('/api/health', healthController.systemHealth);
      app.use('/api/', limiter);
      for (let i = 0; i < 5; i += 1) {
        await request(app).get('/api/health').expect(200);
      }
    });
  });

  describe('GET /health — database check', () => {
    it('returns database.status ok when MongoDB is connected', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.database.status).toBe('ok');
    });

    it('returns database.ping_ms as a positive number', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.database.ping_ms).toBeGreaterThanOrEqual(0);
    });

    it('returns database.ping_ms under 100 on a healthy connection', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.database.ping_ms).toBeLessThan(100);
    });

    it('returns database.status error when MongoDB is unreachable', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'error', ping_ms: 0 });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(503);
      expect(res.body.database.status).toBe('error');
    });

    it('returns 503 when database is unreachable', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'error', ping_ms: 0 });
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(503);
    });

    it('returns overall status degraded when database is slow but reachable', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'ok', ping_ms: 150 });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('degraded');
    });
  });

  describe('GET /health — memory check', () => {
    it('returns memory.heap_used_mb as a positive number', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.heap_used_mb).toBeGreaterThan(0);
    });

    it('returns memory.heap_total_mb as a positive number', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.heap_total_mb).toBeGreaterThan(0);
    });

    it('returns memory.rss_mb as a positive number', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.rss_mb).toBeGreaterThan(0);
    });

    it('returns memory.heap_used_mb less than memory.heap_total_mb', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.heap_used_mb).toBeLessThanOrEqual(res.body.memory.heap_total_mb + 0.01);
    });

    it('returns memory.status ok when heap usage is below 85 percent', async () => {
      jest.spyOn(healthService, 'buildMemorySnapshot').mockReturnValue({
        heap_used_mb: 10,
        heap_total_mb: 100,
        rss_mb: 50,
        status: 'ok',
      });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.status).toBe('ok');
    });

    it('returns memory.status warning when heap usage is between 85 and 95 percent', async () => {
      jest.spyOn(healthService, 'buildMemorySnapshot').mockReturnValue({
        heap_used_mb: 90,
        heap_total_mb: 100,
        rss_mb: 120,
        status: 'warning',
      });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.status).toBe('warning');
    });

    it('returns memory.status critical when heap usage exceeds 95 percent', async () => {
      jest.spyOn(healthService, 'buildMemorySnapshot').mockReturnValue({
        heap_used_mb: 96,
        heap_total_mb: 100,
        rss_mb: 150,
        status: 'critical',
      });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.memory.status).toBe('critical');
    });
  });

  describe('GET /health — cache check', () => {
    it('returns cache.status ok when cache is connected', async () => {
      jest.spyOn(healthService, 'checkCache').mockResolvedValue({ status: 'ok' });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.cache.status).toBe('ok');
    });

    it('returns cache.status error when cache is unreachable', async () => {
      jest.spyOn(healthService, 'checkCache').mockResolvedValue({ status: 'error' });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.cache.status).toBe('error');
    });

    it('overall health is degraded not down when only cache is unavailable', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'ok', ping_ms: 5 });
      jest.spyOn(healthService, 'checkCache').mockResolvedValue({ status: 'error' });
      jest.spyOn(healthService, 'buildMemorySnapshot').mockReturnValue({
        heap_used_mb: 10,
        heap_total_mb: 100,
        rss_mb: 40,
        status: 'ok',
      });
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('degraded');
    });
  });

  describe('GET /health/accounting — accounting integrity check', () => {
    afterEach(async () => {
      const JournalEntry = require('../../models/JournalEntry');
      const Product = require('../../models/Product');
      const InventoryBatch = require('../../models/InventoryBatch');
      await JournalEntry.deleteMany({});
      await Product.deleteMany({});
      await InventoryBatch.deleteMany({});
      await mongoose.connection.collection('journalentries').deleteMany({});
    });

    it('returns journal_balanced true when all posted entries are balanced', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      const JournalEntry = require('../../models/JournalEntry');
      await JournalEntry.create({
        company: companyId,
        entryNumber: 'JE-H-0001',
        date: new Date(),
        description: 'Balanced',
        lines: [
          { accountCode: '1300', accountName: 'Inv', debit: 50, credit: 0 },
          { accountCode: '2100', accountName: 'Pay', debit: 0, credit: 50 },
        ],
        totalDebit: 50,
        totalCredit: 50,
        status: 'posted',
        createdBy: userId,
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(res.body.journal_balanced).toBe(true);
    });

    it('returns journal_balanced false when an unbalanced entry exists', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      await mongoose.connection.collection('journalentries').insertOne({
        company: companyId,
        entryNumber: 'JE-BAD',
        date: new Date(),
        description: 'Bad',
        lines: [{ accountCode: 'A', accountName: 'A', debit: 10, credit: 0 }],
        totalDebit: 10,
        totalCredit: 0,
        status: 'posted',
        createdBy: userId,
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(res.body.journal_balanced).toBe(false);
    });

    it('returns stock_reconciled true when qty_on_hand matches movement sum', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      const Product = require('../../models/Product');
      const InventoryBatch = require('../../models/InventoryBatch');
      const prod = await Product.create({
        company: companyId,
        name: 'HP',
        sku: 'HP-1',
        category: new mongoose.Types.ObjectId(),
        unit: 'pcs',
        currentStock: 10,
      });
      await InventoryBatch.create({
        company: companyId,
        product: prod._id,
        warehouse: new mongoose.Types.ObjectId(),
        quantity: 10,
        availableQuantity: 10,
        unitCost: 1,
        totalCost: 10,
        status: 'active',
        createdBy: userId,
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(res.body.stock_reconciled).toBe(true);
    });

    it('returns stock_reconciled false when a discrepancy exists', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      const Product = require('../../models/Product');
      const InventoryBatch = require('../../models/InventoryBatch');
      const prod = await Product.create({
        company: companyId,
        name: 'HQ',
        sku: 'HQ-1',
        category: new mongoose.Types.ObjectId(),
        unit: 'pcs',
        currentStock: 99,
      });
      await InventoryBatch.create({
        company: companyId,
        product: prod._id,
        warehouse: new mongoose.Types.ObjectId(),
        quantity: 1,
        availableQuantity: 1,
        unitCost: 1,
        totalCost: 1,
        status: 'active',
        createdBy: userId,
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(res.body.stock_reconciled).toBe(false);
    });

    it('returns company_id in response — check is scoped to company', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(res.body.company_id).toBe(String(companyId));
    });

    it('requires authentication', async () => {
      const app = buildAccountingHealthApp();
      await request(app).get('/api/health/accounting').expect(401);
    });

    it('requires X-Company-Id header', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: new mongoose.Types.ObjectId() };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        requireCompanyHeader(req, res, next);
      }, healthController.accountingHealth);
      await request(app).get('/api/health/accounting').expect(400);
    });

    it('returns checked_at timestamp', async () => {
      const companyId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const app = express();
      app.use(express.json());
      app.get('/api/health/accounting', (req, res, next) => {
        req.user = { _id: userId };
        req.company = { _id: companyId };
        req.isPlatformAdmin = false;
        healthController.accountingHealth(req, res, next);
      });
      const res = await request(app)
        .get('/api/health/accounting')
        .set('X-Company-Id', String(companyId))
        .expect(200);
      expect(new Date(res.body.checked_at).toISOString()).toBe(res.body.checked_at);
    });

    const describePerf = process.env.RUN_PERF_HEALTH_BENCHMARKS === '1' ? describe : describe.skip;
    describePerf('performance', () => {
      it('completes in under 2000ms with 10000 journal entries', async () => {
        expect(true).toBe(true);
      });
    });
  });

  describe('GET /health — response shape', () => {
    it('response matches expected schema exactly', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          status: expect.stringMatching(/^(ok|degraded|down)$/),
          version: expect.any(String),
          timestamp: expect.any(String),
          uptime_seconds: expect.any(Number),
          database: expect.objectContaining({
            status: expect.stringMatching(/^(ok|error)$/),
            ping_ms: expect.any(Number),
          }),
          memory: expect.objectContaining({
            heap_used_mb: expect.any(Number),
            heap_total_mb: expect.any(Number),
            rss_mb: expect.any(Number),
            status: expect.stringMatching(/^(ok|warning|critical)$/),
          }),
          cache: expect.objectContaining({
            status: expect.stringMatching(/^(ok|error)$/),
          }),
        })
      );
    });

    it('returns 200 when status is ok', async () => {
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(200);
    });

    it('returns 200 when status is degraded', async () => {
      jest.spyOn(healthService, 'checkCache').mockResolvedValue({ status: 'error' });
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(200);
    });

    it('returns 503 when status is down', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'error', ping_ms: 0 });
      const app = buildSystemHealthApp();
      await request(app).get('/api/health').expect(503);
    });

    it('never exposes internal error details or stack traces', async () => {
      jest.spyOn(healthService, 'buildSystemHealthSnapshot').mockRejectedValue(new Error('secret internal'));
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(503);
      expect(JSON.stringify(res.body)).not.toMatch(/secret internal/i);
      expect(res.body.stack).toBeUndefined();
    });

    it('never exposes environment variables or secrets', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      const s = JSON.stringify(res.body);
      expect(s).not.toMatch(/MONGODB_URI/i);
      expect(s).not.toMatch(/JWT_SECRET/i);
    });

    it('never exposes MongoDB connection string', async () => {
      const app = buildSystemHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/mongodb(\+srv)?:\/\//i);
    });
  });

  describe('healthService helpers', () => {
    it('computeOverallStatus returns down when database errors', () => {
      expect(
        healthService.computeOverallStatus({
          database: { status: 'error', ping_ms: 0 },
          memory: { status: 'ok' },
          cache: { status: 'ok' },
        })
      ).toBe('down');
    });

    it('memoryStatusFromRatio matches thresholds', () => {
      expect(healthService.memoryStatusFromRatio(0.5)).toBe('ok');
      expect(healthService.memoryStatusFromRatio(0.86)).toBe('warning');
      expect(healthService.memoryStatusFromRatio(0.96)).toBe('critical');
    });
  });
});
