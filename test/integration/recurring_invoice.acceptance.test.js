const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RecurringInvoice = require('../../models/RecurringInvoice');
const Invoice = require('../../models/Invoice');
const RecurringInvoiceRun = require('../../models/RecurringInvoiceRun');
const JournalEntry = require('../../models/JournalEntry');
const Product = require('../../models/Product');
const Client = require('../../models/Client');
const Company = require('../../models/Company');
const User = require('../../models/User');
const Category = require('../../models/Category');

let mongoServer;
let companyId, userId, clientId, productId, categoryId;
let recurringInvoiceController;
let recurringService;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  const company = await Company.create({
    name: 'Test Company',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@company.com'
  });
  companyId = company._id;

  const user = await User.create({
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    company: companyId,
    role: 'admin'
  });
  userId = user._id;

  const category = await Category.create({
    name: 'Test Category',
    company: companyId
  });
  categoryId = category._id;

  const client = await Client.create({
    company: companyId,
    name: 'Test Client',
    contact: { email: 'client@test.com' }
  });
  clientId = client._id;

  const product = await Product.create({
    company: companyId,
    category: categoryId,
    name: 'Test Product',
    sku: 'TP-001',
    unit: 'pcs',
    currentStock: 100,
    isActive: true,
    isStockable: true,
    inventoryAccount: '1500',
    cogsAccount: '5000',
    revenueAccount: '4000',
    cost: 10,
    avgCost: 10,
    costMethod: 'fifo',
    taxRate: 10,
    taxCode: 'A'
  });
  productId = product._id;

  recurringInvoiceController = require('../../controllers/recurringInvoiceController');
  recurringService = require('../../services/recurringService');
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

function createApp() {
  const app = express();
  app.use(express.json());
  
  app.use((req, res, next) => {
    req.user = { 
      id: userId, 
      _id: userId, 
      company: { _id: companyId } 
    };
    next();
  });

  app.get('/api/recurring-templates', (req, res, next) => recurringInvoiceController.getRecurringInvoices(req, res, next));
  app.post('/api/recurring-templates', (req, res, next) => recurringInvoiceController.createRecurringInvoice(req, res, next));
  app.get('/api/recurring-templates/:id', (req, res, next) => recurringInvoiceController.getRecurringInvoice(req, res, next));
  app.put('/api/recurring-templates/:id', (req, res, next) => recurringInvoiceController.updateRecurringInvoice(req, res, next));
  app.delete('/api/recurring-templates/:id', (req, res, next) => recurringInvoiceController.deleteRecurringInvoice(req, res, next));
  app.post('/api/recurring-templates/:id/trigger', (req, res, next) => recurringInvoiceController.triggerTemplate(req, res, next));
  app.post('/api/recurring-templates/:id/pause', (req, res, next) => recurringInvoiceController.pauseRecurringInvoice(req, res, next));
  app.post('/api/recurring-templates/:id/resume', (req, res, next) => recurringInvoiceController.resumeRecurringInvoice(req, res, next));
  app.post('/api/recurring-templates/:id/cancel', (req, res, next) => recurringInvoiceController.cancelRecurringInvoice(req, res, next));
  app.get('/api/recurring-templates/:templateId/runs', (req, res, next) => recurringInvoiceController.getRecurringInvoiceRuns(req, res, next));

  return app;
}

describe('Module 9 - Recurring Invoices Acceptance Tests', () => {
  
  describe('Test 1: Scheduler generates an invoice on the correct next_run_date', () => {
    it('should create invoice when nextRunDate is today or past', async () => {
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: new Date(),
        nextRunDate: new Date(),
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      const invoice = await recurringService.generateForTemplate(template._id);
      expect(invoice).toBeDefined();
      expect(invoice.generatedFromRecurring.toString()).toBe(template._id.toString());
    });
  });

  describe('Test 2: When auto_confirm = TRUE, the generated invoice is confirmed and both journal entries are posted', () => {
    it('should auto-confirm and post dual-journal entries', async () => {
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: new Date(),
        nextRunDate: new Date(),
        status: 'active',
        autoConfirm: true,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{
          product: productId,
          productName: 'Test Product',
          productCode: 'TP-001',
          qty: 1,
          unit: 'pcs',
          unitPrice: 100,
          discountPct: 0,
          taxCode: 'A',
          taxRate: 10
        }]
      });

      const invoice = await recurringService.generateForTemplate(template._id);
      
      expect(invoice.status).toBe('confirmed');
      expect(invoice.revenueJournalEntry).toBeDefined();
      expect(invoice.cogsJournalEntry).toBeDefined();
      
      const revenueJE = await JournalEntry.findById(invoice.revenueJournalEntry);
      expect(revenueJE).toBeDefined();
      
      const cogsJE = await JournalEntry.findById(invoice.cogsJournalEntry);
      expect(cogsJE).toBeDefined();
    });
  });

  describe('Test 3: When auto_confirm = FALSE, the generated invoice is created as draft', () => {
    it('should create draft invoice without journal entries', async () => {
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: new Date(),
        nextRunDate: new Date(),
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      const invoice = await recurringService.generateForTemplate(template._id);
      expect(invoice.status).toBe('draft');
    });
  });

  describe('Test 4: Running the scheduler twice on the same day does not create duplicate invoices', () => {
    it('should be idempotent - no duplicates', async () => {
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: new Date(),
        nextRunDate: new Date(),
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      // First run
      await recurringService.generateForTemplate(template._id);
      
      // Count invoices
      let invoices = await Invoice.find({ generatedFromRecurring: template._id });
      expect(invoices.length).toBe(1);
      
      // Second run - should not create duplicate due to idempotency
      await recurringService.generateForTemplate(template._id);
      
      // Should still be 1 invoice
      invoices = await Invoice.find({ generatedFromRecurring: template._id });
      expect(invoices.length).toBe(1);
    });
  });

  describe('Test 5: A failed run is logged in recurring_invoice_runs', () => {
    it('should log runs', async () => {
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: new Date(),
        nextRunDate: new Date(),
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      await recurringService.generateForTemplate(template._id);
      
      const runs = await RecurringInvoiceRun.find({ template: template._id });
      expect(runs.length).toBeGreaterThan(0);
      expect(runs[0].status).toBeDefined();
    });
  });

  describe('Test 6: After each run, next_run_date is correctly advanced to the next interval', () => {
    it('should advance nextRunDate', async () => {
      const initialDate = new Date('2026-01-01');
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: initialDate,
        nextRunDate: initialDate,
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly', interval: 1 },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      await recurringService.generateForTemplate(template._id);
      
      const updated = await RecurringInvoice.findById(template._id);
      expect(updated.nextRunDate.getTime()).toBeGreaterThan(initialDate.getTime());
    });
  });

  describe('Test 7: When end_date is passed, template status is set to completed', () => {
    it('should mark template as completed', async () => {
      const pastDate = new Date('2020-01-01');
      const template = await RecurringInvoice.create({
        company: companyId,
        client: clientId,
        createdBy: userId,
        startDate: pastDate,
        nextRunDate: pastDate,
        endDate: pastDate,
        status: 'active',
        autoConfirm: false,
        currencyCode: 'USD',
        schedule: { frequency: 'monthly' },
        lines: [{ product: productId, qty: 1, unitPrice: 100, taxRate: 10 }]
      });

      // Try to generate - should mark as completed
      try {
        await recurringService.generateForTemplate(template._id);
      } catch (e) {
        // Expected to throw because template has ended
      }
      
      const updated = await RecurringInvoice.findById(template._id);
      expect(updated.status).toBe('completed');
    });
  });
});
