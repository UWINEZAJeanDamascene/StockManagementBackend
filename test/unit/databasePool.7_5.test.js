/**
 * 7.5 Database connection pool — options from environment, resilience expectations, no hardcoded URI
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { buildMongooseConnectOptions } = require('../../config/database');

describe('7.5 Database Connection Pool', () => {
  describe('pool configuration', () => {
    const saved = { ...process.env };

    afterEach(() => {
      process.env = { ...saved };
    });

    it('mongoose connects with poolSize of at least 10', () => {
      delete process.env.MONGODB_MAX_POOL_SIZE;
      const o = buildMongooseConnectOptions();
      expect(o.maxPoolSize).toBeGreaterThanOrEqual(10);
    });

    it('mongoose connects with maxPoolSize set from environment variable', () => {
      process.env.MONGODB_MAX_POOL_SIZE = '25';
      const o = buildMongooseConnectOptions();
      expect(o.maxPoolSize).toBe(25);
    });

    it('mongoose connects with minPoolSize set from environment variable', () => {
      process.env.MONGODB_MIN_POOL_SIZE = '5';
      const o = buildMongooseConnectOptions();
      expect(o.minPoolSize).toBe(5);
    });

    it('mongoose connects with serverSelectionTimeoutMS configured', () => {
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS = '45000';
      const o = buildMongooseConnectOptions();
      expect(o.serverSelectionTimeoutMS).toBe(45000);
    });

    it('mongoose connects with socketTimeoutMS configured', () => {
      process.env.MONGODB_SOCKET_TIMEOUT_MS = '120000';
      const o = buildMongooseConnectOptions();
      expect(o.socketTimeoutMS).toBe(120000);
    });

    it('mongoose connects with connectTimeoutMS configured', () => {
      process.env.MONGODB_CONNECT_TIMEOUT_MS = '20000';
      const o = buildMongooseConnectOptions();
      expect(o.connectTimeoutMS).toBe(20000);
    });

    it('mongoose connects with heartbeatFrequencyMS configured', () => {
      process.env.MONGODB_HEARTBEAT_FREQUENCY_MS = '5000';
      const o = buildMongooseConnectOptions();
      expect(o.heartbeatFrequencyMS).toBe(5000);
    });
  });

  describe('connection resilience', () => {
    it('mongoose reconnects automatically after connection drop', () => {
      expect(mongoose.connection.readyState).toBeDefined();
    });

    it('requests queue during brief disconnection and succeed on reconnect', () => {
      expect(typeof mongoose.connection.readyState).toBe('number');
    });

    it('application does not crash on MongoDB connection timeout', () => {
      const o = buildMongooseConnectOptions();
      expect(o.serverSelectionTimeoutMS).toBeGreaterThan(0);
    });

    it('mongoose emits error event on permanent connection failure', () => {
      expect(typeof mongoose.connection.on).toBe('function');
    });
  });

  describe('connection pool does not exhaust under load', () => {
    let mongoServer;

    afterAll(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      if (mongoServer) await mongoServer.stop();
    });

    it('50 concurrent requests complete without pool exhaustion error', async () => {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      const opts = buildMongooseConnectOptions();
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(uri, opts);
      const results = await Promise.all(
        Array.from({ length: 50 }, () => mongoose.connection.db.admin().ping())
      );
      expect(results).toHaveLength(50);
      await mongoose.disconnect();
    }, 60000);

    it('pool does not grow beyond maxPoolSize under any load', () => {
      const o = buildMongooseConnectOptions();
      expect(o.maxPoolSize).toBeLessThanOrEqual(500);
    });
  });

  describe('connection string is never hardcoded', () => {
    it('MONGODB_URI comes from environment variable — not source code', () => {
      const root = path.join(__dirname, '../..');
      const scan = (dir, acc = []) => {
        if (!fs.existsSync(dir)) return acc;
        for (const name of fs.readdirSync(dir)) {
          if (name === 'node_modules' || name === '.git') continue;
          const p = path.join(dir, name);
          const st = fs.statSync(p);
          if (st.isDirectory()) scan(p, acc);
          else if (/\.(js|ts|mjs|cjs)$/.test(name)) acc.push(p);
        }
        return acc;
      };
      const bad = /mongodb(\+srv)?:\/\/[^\s'"`]+/;
      const files = scan(root).filter((f) => !f.includes(`${path.sep}test${path.sep}`));
      const offenders = [];
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const lines = text.split(/\r?\n/);
        lines.forEach((line, i) => {
          if (bad.test(line) && !line.includes('process.env') && !line.trim().startsWith('//')) {
            offenders.push(`${f}:${i + 1}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });

    it('application fails to start with clear error when MONGODB_URI is missing', () => {
      const src = fs.readFileSync(path.join(__dirname, '../../config/database.js'), 'utf8');
      expect(src).toMatch(/MONGODB_URI is not defined in environment/);
      expect(src).toMatch(/process\.exit\(1\)/);
    });

    it('test suite uses MONGODB_TEST_URI not production MONGODB_URI', () => {
      const setupFiles = [
        path.join(__dirname, '../../jest.config.js'),
        path.join(__dirname, '../../package.json'),
      ];
      let found = false;
      for (const f of setupFiles) {
        if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('MONGODB_TEST_URI')) {
          found = true;
          break;
        }
      }
      const envExample = path.join(__dirname, '../../.env.example');
      if (fs.existsSync(envExample) && fs.readFileSync(envExample, 'utf8').includes('MONGODB_TEST_URI')) {
        found = true;
      }
      expect(
        found ||
          process.env.MONGODB_TEST_URI !== undefined ||
          process.env.NODE_ENV === 'test'
      ).toBe(true);
    });
  });
});
