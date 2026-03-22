/**
 * express-validator chains, validateRequest (422), stripUnvalidatedBody, Invoice dates
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { body, query, param } = require('express-validator');
const validateRequest = require('../../../middleware/validateRequest');
const stripUnvalidatedBody = require('../../../middleware/stripUnvalidatedBody');
const Invoice = require('../../../models/Invoice');

describe('Request Validation', () => {
  it('returns 422 with field errors when required field missing', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/',
      body('title').notEmpty().withMessage('Title is required'),
      validateRequest,
      (req, res) => res.json({ ok: true }),
    );

    const res = await request(app).post('/').send({}).expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.message).toMatch(/title/i);
  });

  it('strips unknown fields from request body', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/',
      body('name').trim().notEmpty().withMessage('Name required'),
      body('count').optional().isInt().withMessage('Count must be int'),
      validateRequest,
      stripUnvalidatedBody,
      (req, res) => res.json({ body: req.body }),
    );

    const res = await request(app)
      .post('/')
      .send({ name: 'alice', extra: 'drop-me', hacker: { nest: true } })
      .expect(200);

    expect(res.body.body).toEqual({ name: 'alice' });
    expect(res.body.body.extra).toBeUndefined();
    expect(res.body.body.hacker).toBeUndefined();
  });

  it('coerces string numbers to numbers in query params', async () => {
    const app = express();
    app.get(
      '/',
      query('page').toInt().isInt({ min: 1 }).withMessage('page must be >= 1'),
      validateRequest,
      (req, res) => res.json({ page: req.query.page, t: typeof req.query.page }),
    );

    const res = await request(app).get('/?page=7').expect(200);

    expect(res.body.page).toBe(7);
    expect(res.body.t).toBe('number');
  });

  it('email is lowercased and trimmed', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/',
      body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
      validateRequest,
      stripUnvalidatedBody,
      (req, res) => res.json({ email: req.body.email }),
    );

    const res = await request(app)
      .post('/')
      .send({ email: '  Jane.Doe@EXAMPLE.COM \t' })
      .expect(200);

    expect(res.body.email).toBe('jane.doe@example.com');
  });

  it('invalid ObjectId returns clear field error', async () => {
    const app = express();
    app.use(express.json());
    app.get(
      '/:id',
      param('id').isMongoId().withMessage('Invalid id'),
      validateRequest,
      (req, res) => res.json({ id: req.params.id }),
    );

    const res = await request(app).get('/not-a-valid-object-id').expect(422);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    const idErr = res.body.errors.find((e) => e.path === 'id' || e.param === 'id');
    expect(idErr).toBeDefined();
    expect(String(idErr.msg || idErr.message)).toMatch(/invalid/i);
  });

  it('due_date before invoice_date returns validation error', async () => {
    const inv = new Invoice({
      company: new mongoose.Types.ObjectId(),
      client: new mongoose.Types.ObjectId(),
      invoiceDate: new Date('2025-06-20'),
      dueDate: new Date('2025-06-01'),
    });

    let validationErr;
    try {
      await inv.validate();
    } catch (e) {
      validationErr = e;
    }
    expect(validationErr).toBeDefined();
    expect(validationErr.errors.dueDate).toBeDefined();
    expect(validationErr.errors.dueDate.message).toMatch(/on or after invoice date/i);
  });
});
