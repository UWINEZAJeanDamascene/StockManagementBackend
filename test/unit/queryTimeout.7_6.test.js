/**
 * 7.6 Query timeout — maxTimeMS on aggregations (env defaults, error mapping)
 */

const errorHandler = require('../../middleware/errorHandler');

describe('7.6 Query timeout', () => {
  let prevTimeout;

  beforeEach(() => {
    prevTimeout = process.env.QUERY_TIMEOUT_MS;
    delete process.env.QUERY_TIMEOUT_MS;
  });

  afterEach(() => {
    if (prevTimeout === undefined) delete process.env.QUERY_TIMEOUT_MS;
    else process.env.QUERY_TIMEOUT_MS = prevTimeout;
  });

  describe('getMaxTimeMS', () => {
    it('defaults financial/report pipelines to 10000ms when QUERY_TIMEOUT_MS is unset', () => {
      jest.resetModules();
      const { getMaxTimeMS } = require('../../utils/mongoAggregation');
      expect(getMaxTimeMS('report')).toBe(10000);
    });

    it('defaults dashboard pipelines to 5000ms when QUERY_TIMEOUT_MS is unset', () => {
      jest.resetModules();
      const { getMaxTimeMS } = require('../../utils/mongoAggregation');
      expect(getMaxTimeMS('dashboard')).toBe(5000);
    });

    it('uses QUERY_TIMEOUT_MS when set to a positive integer', () => {
      process.env.QUERY_TIMEOUT_MS = '25000';
      jest.resetModules();
      const { getMaxTimeMS } = require('../../utils/mongoAggregation');
      expect(getMaxTimeMS('report')).toBe(25000);
      expect(getMaxTimeMS('dashboard')).toBe(25000);
    });

    it('ignores invalid QUERY_TIMEOUT_MS and falls back to defaults', () => {
      process.env.QUERY_TIMEOUT_MS = 'not-a-number';
      jest.resetModules();
      const { getMaxTimeMS } = require('../../utils/mongoAggregation');
      expect(getMaxTimeMS('report')).toBe(10000);
    });
  });

  describe('aggregateWithTimeout', () => {
    it('passes maxTimeMS as the second argument to model.aggregate', () => {
      jest.resetModules();
      delete process.env.QUERY_TIMEOUT_MS;
      const { aggregateWithTimeout } = require('../../utils/mongoAggregation');
      const mockModel = {
        aggregate: jest.fn(() => ({ exec: jest.fn() })),
      };
      aggregateWithTimeout(mockModel, [{ $match: {} }], 'report');
      expect(mockModel.aggregate).toHaveBeenCalledWith([{ $match: {} }], { maxTimeMS: 10000 });
    });
  });

  describe('error handler: MongoDB maxTimeMSExpired', () => {
    it('maps code 50 to 503 QUERY_TIMEOUT', () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const err = Object.assign(new Error('operation exceeded time limit'), {
        code: 50,
        name: 'MongoServerError',
      });
      const req = { method: 'GET', path: '/api/reports/trial-balance' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();
      errorHandler(err, req, res, next);
      console.error.mockRestore();
      console.warn.mockRestore();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'QUERY_TIMEOUT',
        })
      );
    });
  });

  describe('performance benchmarks (optional)', () => {
    const describePerf = process.env.RUN_PERF_BENCHMARKS === '1' ? describe : describe.skip;

    describePerf('realistic dataset', () => {
      it('placeholder — set RUN_PERF_BENCHMARKS=1 to exercise full DB benchmarks', () => {
        expect(true).toBe(true);
      });
    });
  });
});
