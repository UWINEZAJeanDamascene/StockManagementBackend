/**
 * Global Express error handler — status codes, shape, production safety
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const errorHandler = require('../../../middleware/errorHandler');

function appWithError(errFactory) {
  const app = express();
  app.get('/t', (req, res, next) => {
    next(errFactory());
  });
  app.use(errorHandler);
  return app;
}

describe('Global Error Handler', () => {
  it('returns consistent error format for all error types', async () => {
    const apps = [
      appWithError(() => Object.assign(new Error('gone'), { code: 'NOT_FOUND', statusCode: 404 })),
      appWithError(() => Object.assign(new Error('closed'), { code: 'PERIOD_CLOSED', statusCode: 409 })),
      appWithError(() => new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id')),
    ];

    for (const app of apps) {
      const res = await request(app).get('/t').expect((r) => {
        expect(r.status).toBeGreaterThanOrEqual(400);
      });
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('message');
      expect(typeof res.body.message).toBe('string');
      expect(res.body).toHaveProperty('code');
      expect(typeof res.body.code).toBe('string');
    }
  });

  it('does not expose stack trace in production mode', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const app = appWithError(() => {
      const e = new Error('Sensitive internals');
      e.stack = 'Error: Sensitive\n  at secret.js:1:1';
      return e;
    });

    try {
      const res = await request(app).get('/t').expect(500);
      expect(res.body.stack).toBeUndefined();
      expect(res.body.code).toBe('INTERNAL_ERROR');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('maps PERIOD_CLOSED to 409 status', async () => {
    const app = appWithError(() =>
      Object.assign(new Error('Period is closed for posting'), {
        code: 'PERIOD_CLOSED',
      }),
    );
    const res = await request(app).get('/t').expect(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'PERIOD_CLOSED',
    });
    expect(res.body.message).toMatch(/closed/i);
  });

  it('maps NOT_FOUND to 404 status', async () => {
    const app = appWithError(() =>
      Object.assign(new Error('Invoice not found'), {
        code: 'NOT_FOUND',
        statusCode: 404,
      }),
    );
    const res = await request(app).get('/t').expect(404);
    expect(res.body).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
    });
  });

  it('maps INSUFFICIENT_STOCK to 409 status', async () => {
    const app = appWithError(() =>
      Object.assign(new Error('Not enough units'), {
        code: 'INSUFFICIENT_STOCK',
      }),
    );
    const res = await request(app).get('/t').expect(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INSUFFICIENT_STOCK',
    });
  });

  it('maps Mongoose duplicate key to 409 with DUPLICATE_KEY code', async () => {
    const dup = new Error('E11000 duplicate key error');
    dup.code = 11000;
    dup.keyValue = { code: 'SKU-1' };

    const app = appWithError(() => dup);
    const res = await request(app).get('/t').expect(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'DUPLICATE_KEY',
    });
    expect(res.body.message).toMatch(/Duplicate field value/i);
    expect(res.body.message).toMatch(/code/i);
  });

  it('maps Mongoose CastError to 422 with INVALID_ID code', async () => {
    const app = appWithError(
      () => new mongoose.Error.CastError('ObjectId', 'bad-id', '_id'),
    );
    const res = await request(app).get('/t').expect(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_ID',
      message: 'Invalid id',
    });
  });

  it('returns INTERNAL_ERROR for unknown errors in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const app = appWithError(() => new Error('SECRET_DB_CONNECTION_STRING=xyz'));

    try {
      const res = await request(app).get('/t').expect(500);
      expect(res.body).toMatchObject({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
      expect(res.body.message).not.toMatch(/SECRET_DB/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
