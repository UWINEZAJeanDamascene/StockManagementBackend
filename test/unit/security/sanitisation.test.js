/**
 * sanitizeInput middleware + hpp
 */

const express = require('express');
const request = require('supertest');
const hpp = require('hpp');
const sanitizeInput = require('../../../middleware/sanitizeInput');

function appWithSanitize() {
  const app = express();
  app.use(express.json());
  app.use(sanitizeInput);
  app.post('/echo', (req, res) => res.json(req.body));
  return app;
}

function appWithHpp() {
  const app = express();
  app.use(hpp());
  app.get('/q', (req, res) => res.json({ sort: req.query.sort, type: typeof req.query.sort }));
  return app;
}

describe('Input Sanitisation', () => {
  it('strips MongoDB operators from request body', async () => {
    const app = appWithSanitize();
    const res = await request(app)
      .post('/echo')
      .send({ $where: 'malicious', normal: 'ok' })
      .expect(200);

    expect(res.body.$where).toBeUndefined();
    expect(res.body._where).toBe('malicious');
    expect(res.body.normal).toBe('ok');
  });

  it('replaces $ with _ in nested object keys', async () => {
    const app = appWithSanitize();
    const res = await request(app)
      .post('/echo')
      .send({ outer: { $gt: 1, safe: 2 } })
      .expect(200);

    expect(res.body.outer).toEqual({ _gt: 1, safe: 2 });
    expect(res.body.outer.$gt).toBeUndefined();
  });

  it('strips script tags from string values', async () => {
    const app = appWithSanitize();
    const res = await request(app)
      .post('/echo')
      .send({ text: 'Hi<script>alert(1)</script>there' })
      .expect(200);

    expect(res.body.text).not.toMatch(/<|>/);
    expect(res.body.text).not.toMatch(/script/i);
    expect(res.body.text).toBe('Hialert(1)there');
  });

  it('strips HTML tags from string values', async () => {
    const app = appWithSanitize();
    const res = await request(app)
      .post('/echo')
      .send({ html: '<div class="x">Content</div>' })
      .expect(200);

    expect(res.body.html).toBe('Content');
    expect(res.body.html).not.toMatch(/[<>]/);
  });

  it('HPP prevents duplicate query param pollution', async () => {
    const app = appWithHpp();
    const res = await request(app).get('/q?sort=name&sort=evil').expect(200);

    expect(Array.isArray(res.body.sort)).toBe(false);
    expect(res.body.type).toBe('string');
    expect(res.body.sort).toBe('evil');
  });
});
