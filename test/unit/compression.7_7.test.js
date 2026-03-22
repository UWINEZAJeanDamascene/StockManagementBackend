/**
 * 7.7 Response compression — gzip/deflate, threshold, Accept-Encoding
 */

const express = require('express');
const compression = require('compression');
const request = require('supertest');

function buildApp() {
  const app = express();
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.path === '/health') return false;
        return compression.filter(req, res);
      },
    })
  );
  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });
  app.get('/large', (req, res) => {
    res.json({ data: 'x'.repeat(2000) });
  });
  app.get('/small', (req, res) => {
    res.json({ ok: 1 });
  });
  app.get('/unicode', (req, res) => {
    res.json({ company: 'Acme Co. — 日本' });
  });
  return app;
}

describe('7.7 Compression', () => {
  const app = buildApp();

  it('compresses responses above threshold when client accepts gzip', async () => {
    const res = await request(app)
      .get('/large')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toMatch(/gzip|deflate/);
    expect(res.body).toEqual({ data: 'x'.repeat(2000) });
  });

  it('does not compress /health (filtered)', async () => {
    const res = await request(app)
      .get('/health')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('may skip compression for small payloads under threshold', async () => {
    const res = await request(app)
      .get('/small')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.body).toEqual({ ok: 1 });
    // Under 1024 bytes — typically no compression
    if (res.headers['content-length']) {
      expect(Number(res.headers['content-length'])).toBeLessThan(1024);
    }
  });

  it('preserves Unicode in JSON bodies', async () => {
    const res = await request(app).get('/unicode').expect(200);
    expect(res.body.company).toContain('日本');
  });
});
