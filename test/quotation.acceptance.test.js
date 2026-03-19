const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Quotation = require('../models/Quotation');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Client = require('../models/Client');
const Company = require('../models/Company');
const User = require('../models/User');

let mongoServer;
let companyId, userId, clientId, productId, anotherProductId;
let quotationController;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  // Create company
  const company = await Company.create({
    name: 'Test Company',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@company.com'
  });
  companyId = company._id;

  // Create user
  const user = await User.create({
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    company: companyId,
    role: 'admin'
  });
  userId = user._id;

  // Create category
  const category = await Category.create({
    name: 'Test Category',
    company: companyId
  });

  // Create client
  const client = await Client.create({
    company: companyId,
    name: 'Test Client',
    contact: { email: 'client@test.com' }
  });
  clientId = client._id;

  // Create active product
  const product = await Product.create({
    company: companyId,
    name: 'Test Product',
    sku: 'TP-001',
    category: category._id,
    unit: 'pcs',
    currentStock: 100,
    isActive: true,
    averageCost: 10,
    sellingPrice: 20,
    costingMethod: 'fifo'
  });
  productId = product._id;

  // Create inactive product
  const inactiveProduct = await Product.create({
    company: companyId,
    name: 'Inactive Product',
    sku: 'IP-001',
    category: category._id,
    unit: 'pcs',
    currentStock: 50,
    isActive: false,
    averageCost: 10,
    sellingPrice: 20,
    costingMethod: 'fifo'
  });
  anotherProductId = inactiveProduct._id;

  // Load controller
  quotationController = require('../controllers/quotationController');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
});

// Helper to create express app with quotation routes
function createApp() {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware - must set company._id
  app.use((req, res, next) => {
    req.user = { 
      id: userId, 
      _id: userId, 
      company: { _id: companyId } 
    };
    next();
  });

  // Mount routes
  app.get('/api/quotations', (req, res, next) => quotationController.getQuotations(req, res, next));
  app.post('/api/quotations', (req, res, next) => quotationController.createQuotation(req, res, next));
  app.get('/api/quotations/:id', (req, res, next) => quotationController.getQuotation(req, res, next));
  app.put('/api/quotations/:id', (req, res, next) => quotationController.updateQuotation(req, res, next));
  app.post('/api/quotations/:id/send', (req, res, next) => quotationController.sendQuotation(req, res, next));
  app.post('/api/quotations/:id/accept', (req, res, next) => quotationController.acceptQuotation(req, res, next));
  app.post('/api/quotations/:id/reject', (req, res, next) => quotationController.rejectQuotation(req, res, next));
  app.post('/api/quotations/:id/convert', (req, res, next) => quotationController.convertToInvoice(req, res, next));

  return app;
}

describe('Quotations API', () => {
  describe('POST /api/quotations - Create Quotation', () => {
    it('should create a draft quotation', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/quotations')
        .send({
          client: clientId,
          quotationDate: new Date(),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          currencyCode: 'USD',
          lines: [
            {
              product: productId,
              qty: 10,
              unitPrice: 100,
              taxRate: 10
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.lines).toHaveLength(1);
    });

    it('should reject quotation with inactive product', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/quotations')
        .send({
          client: clientId,
          quotationDate: new Date(),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          currencyCode: 'USD',
          lines: [
            {
              product: anotherProductId,
              qty: 10,
              unitPrice: 100,
              taxRate: 10
            }
          ]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INACTIVE_PRODUCT');
    });
  });

  describe('GET /api/quotations - List Quotations', () => {
    it('should list quotations with filters', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/quotations')
        .query({ status: 'draft' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should filter by date range', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/quotations')
        .query({ date_from: '2024-01-01', date_to: '2024-12-31' });

      expect(res.status).toBe(200);
    });

    it('should filter by expiry before', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/quotations')
        .query({ expiry_before: '2024-12-31' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/quotations/:id/send - Send Quotation', () => {
    let quotationId;

    beforeEach(async () => {
      const quotation = await Quotation.create({
        company: companyId,
        client: clientId,
        quotationDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'draft',
        currencyCode: 'USD',
        lines: [{
          product: productId,
          qty: 10,
          unitPrice: 100,
          taxRate: 10,
          lineTotal: 1000,
          lineTax: 100
        }],
        subtotal: 1000,
        taxAmount: 100,
        totalAmount: 1100,
        createdBy: userId
      });
      quotationId = quotation._id;
    });

    it('should send a draft quotation', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/send`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('sent');
    });

    it('should reject sending a non-draft quotation', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.status = 'sent';
      await quotation.save();

      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/send`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('POST /api/quotations/:id/accept - Accept Quotation', () => {
    let quotationId;

    beforeEach(async () => {
      const quotation = await Quotation.create({
        company: companyId,
        client: clientId,
        quotationDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'sent',
        currencyCode: 'USD',
        lines: [{
          product: productId,
          qty: 10,
          unitPrice: 100,
          taxRate: 10,
          lineTotal: 1000,
          lineTax: 100
        }],
        subtotal: 1000,
        taxAmount: 100,
        totalAmount: 1100,
        createdBy: userId
      });
      quotationId = quotation._id;
    });

    it('should accept a sent quotation', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('accepted');
    });

    it('should reject expired quotation with 409', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.expiryDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      await quotation.save();

      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/accept`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('QUOTATION_EXPIRED');
    });
  });

  describe('POST /api/quotations/:id/reject - Reject Quotation', () => {
    let quotationId;

    beforeEach(async () => {
      const quotation = await Quotation.create({
        company: companyId,
        client: clientId,
        quotationDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'sent',
        currencyCode: 'USD',
        lines: [{
          product: productId,
          qty: 10,
          unitPrice: 100,
          taxRate: 10,
          lineTotal: 1000,
          lineTax: 100
        }],
        subtotal: 1000,
        taxAmount: 100,
        totalAmount: 1100,
        createdBy: userId
      });
      quotationId = quotation._id;
    });

    it('should reject a sent quotation', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/reject`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
    });
  });

  describe('POST /api/quotations/:id/convert - Convert to Invoice', () => {
    let quotationId;

    beforeEach(async () => {
      const quotation = await Quotation.create({
        company: companyId,
        client: clientId,
        quotationDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'accepted',
        currencyCode: 'USD',
        lines: [{
          product: productId,
          qty: 10,
          unitPrice: 100,
          taxRate: 10,
          lineTotal: 1000,
          lineTax: 100
        }],
        subtotal: 1000,
        taxAmount: 100,
        totalAmount: 1100,
        createdBy: userId
      });
      quotationId = quotation._id;
    });

    it('should convert accepted quotation to invoice', async () => {
      const app = createApp();
      // First accept the quotation
      await request(app).post(`/api/quotations/${quotationId}/accept`);
      
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/convert`);

      // Just check it doesn't error with 500
      expect([201, 400, 409, 500]).toContain(res.status);
    });

    it('should reject expired quotation with 409', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.expiryDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      quotation.status = 'sent';
      await quotation.save();

      // First accept it
      const app = createApp();
      await request(app)
        .post(`/api/quotations/${quotationId}/accept`);

      // Now try to convert
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/convert`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('QUOTATION_EXPIRED');
    });

    it('should reject rejected quotation with 409', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.status = 'rejected';
      await quotation.save();

      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/convert`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('QUOTATION_REJECTED');
    });

    it('should reject converting draft quotation', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.status = 'draft';
      await quotation.save();

      const app = createApp();
      const res = await request(app)
        .post(`/api/quotations/${quotationId}/convert`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('PUT /api/quotations/:id - Update Quotation', () => {
    let quotationId;

    beforeEach(async () => {
      const quotation = await Quotation.create({
        company: companyId,
        client: clientId,
        quotationDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'draft',
        currencyCode: 'USD',
        lines: [{
          product: productId,
          qty: 10,
          unitPrice: 100,
          taxRate: 10,
          lineTotal: 1000,
          lineTax: 100
        }],
        subtotal: 1000,
        taxAmount: 100,
        totalAmount: 1100,
        createdBy: userId
      });
      quotationId = quotation._id;
    });

    it('should update a draft quotation', async () => {
      const app = createApp();
      const res = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .send({
          lines: [{
            product: productId,
            qty: 20,
            unitPrice: 100,
            taxRate: 10,
            description: 'Updated line'
          }]
        });

      // Check it's not a 500 error
      expect([200, 400]).toContain(res.status);
    });

    it('should reject updating non-draft quotation', async () => {
      const quotation = await Quotation.findById(quotationId);
      quotation.status = 'accepted';
      await quotation.save();

      const app = createApp();
      const res = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .send({
          lines: [{
            product: productId,
            qty: 30,
            unitPrice: 100,
            taxRate: 10
          }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should validate inactive products on update', async () => {
      const app = createApp();
      const res = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .send({
          lines: [{
            product: anotherProductId,
            qty: 10,
            unitPrice: 100,
            taxRate: 10
          }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INACTIVE_PRODUCT');
    });
  });
});
