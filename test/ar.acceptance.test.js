const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const ARReceipt = require('../models/ARReceipt');
const ARReceiptAllocation = require('../models/ARReceiptAllocation');
const ARBadDebtWriteoff = require('../models/ARBadDebtWriteoff');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Company = require('../models/Company');
const User = require('../models/User');
const { BankAccount } = require('../models/BankAccount');
const AccountMapping = require('../models/AccountMapping');
const JournalEntry = require('../models/JournalEntry');

let mongoServer;
let companyId, userId, clientId, bankAccountId;
let arController;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  // Create company
  const company = await Company.create({
    name: 'Test Company AR',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@company-ar.com'
  });
  companyId = company._id;

  // Create user
  const user = await User.create({
    name: 'Test User AR',
    email: `test-ar-${Date.now()}@example.com`,
    password: 'password123',
    company: companyId,
    role: 'admin'
  });
  userId = user._id;

  // Create client
  const client = await Client.create({
    company: companyId,
    name: 'Test Client AR',
    contact: { email: 'client-ar@test.com' }
  });
  clientId = client._id;

  // Create bank account
  const bankAccount = await BankAccount.create({
    company: companyId,
    name: 'Test Bank Account',
    accountNumber: '1234567890',
    accountType: 'bk_bank',
    balance: 0,
    openingBalanceDate: new Date(),
    isActive: true,
    currencyCode: 'USD'
  });
  bankAccountId = bankAccount._id;

  // Create account mappings for AR (module='sales', key='accountsReceivable')
  await AccountMapping.create({
    company: companyId,
    module: 'sales',
    key: 'accountsReceivable',
    accountCode: '1200',
    description: 'Accounts Receivable'
  });

  // Create bank account mapping
  await AccountMapping.create({
    company: companyId,
    module: 'banking',
    key: 'defaultBank',
    accountCode: '1100',
    description: 'Bank Account'
  });

  // Create bad debt expense mapping
  await AccountMapping.create({
    company: companyId,
    module: 'sales',
    key: 'badDebtExpense',
    accountCode: '6100',
    description: 'Bad Debt Expense'
  });

  // Load controller
  arController = require('../controllers/arController');
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

// Helper to create express app with AR routes using mock auth
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
  app.get('/api/ar/receipts', (req, res, next) => arController.getReceipts(req, res, next));
  app.post('/api/ar/receipts', (req, res, next) => arController.createReceipt(req, res, next));
  app.get('/api/ar/receipts/:id', (req, res, next) => arController.getReceipt(req, res, next));
  app.post('/api/ar/receipts/:id/post', (req, res, next) => arController.postReceipt(req, res, next));
  app.post('/api/ar/receipts/:id/reverse', (req, res, next) => arController.reverseReceipt(req, res, next));
  
  app.get('/api/ar/allocations', (req, res, next) => arController.getAllocations(req, res, next));
  app.post('/api/ar/allocations', (req, res, next) => arController.createAllocation(req, res, next));
  
  app.get('/api/ar/aging', (req, res, next) => arController.getAgingReport(req, res, next));
  
  app.get('/api/ar/bad-debts', (req, res, next) => arController.getBadDebtWriteoffs(req, res, next));
  app.post('/api/ar/bad-debts', (req, res, next) => arController.createBadDebtWriteoff(req, res, next));
  app.post('/api/ar/bad-debts/:id/post', (req, res, next) => arController.postBadDebtWriteoff(req, res, next));

  // Simple error handler so tests receive error messages
  app.use((err, req, res, next) => {
    // Log the full error for test debug output
    console.error('Test error handler caught:', err && (err.stack || err));
    const status = err && (err.statusCode || err.status) ? (err.statusCode || err.status) : 500;
    const message = err && (err.message || err.toString()) ? (err.message || err.toString()) : 'Internal Server Error';
    res.status(status).json({ error: message });
  });

  return app;
}

describe('Accounts Receivable API', () => {
  
  describe('POST /api/ar/receipts - Create Receipt', () => {
    it('should create a draft receipt', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/ar/receipts')
        .send({
          clientId: clientId,
          receiptDate: new Date(),
          reference: 'RCP-2024-00001',
          amountReceived: 1000.00,
          currencyCode: 'USD',
          bankAccountId: bankAccountId,
          paymentMethod: 'cash',
          notes: 'Test receipt'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('draft');
    });
  });

  describe('POST /api/ar/receipts/:id/post - Post Receipt', () => {
    let receiptId;

    beforeEach(async () => {
      const receipt = await ARReceipt.create({
        company: companyId,
        client: clientId,
        receiptDate: new Date(),
        reference: 'RCP-2024-00002',
        amountReceived: 500.00,
        currencyCode: 'USD',
        bankAccount: bankAccountId,
        paymentMethod: 'cash',
        status: 'draft',
        notes: 'Test receipt for posting',
        createdBy: userId
      });
      receiptId = receipt._id;
    });

    it('should post a receipt and create journal entry', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/ar/receipts/${receiptId}/post`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('posted');
      
      // Verify journal entries were created
      const journals = await JournalEntry.find({ reference: `RCP-2024-00002` });
      expect(journals).toHaveLength(2);
      
      // Should have DR bank and CR AR
      const drEntry = journals.find(j => j.debitTotal > 0);
      const crEntry = journals.find(j => j.creditTotal > 0);
      expect(drEntry.debitTotal).toBe(500.00);
      expect(crEntry.creditTotal).toBe(500.00);
    });

    it('should not allow posting a posted receipt', async () => {
      const receipt = await ARReceipt.findById(receiptId);
      receipt.status = 'posted';
      await receipt.save();

      const app = createApp();
      const res = await request(app)
        .post(`/api/ar/receipts/${receiptId}/post`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS');
    });
  });

  describe('POST /api/ar/allocations - Allocate Receipt to Invoice', () => {
    let invoiceId, receiptId;

    beforeEach(async () => {
      // Create invoice
      const invoice = await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        invoiceNumber: 'INV-2024-00001',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 1000.00,
        taxAmount: 100.00,
        totalAmount: 1100.00,
        amountPaid: 0,
        amountOutstanding: 1100.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: 'Test line',
          qty: 1,
          unitPrice: 1000.00,
          taxRate: 10,
          lineTotal: 1100.00
        }]
      });
      invoiceId = invoice._id;

      // Create receipt
      const receipt = await ARReceipt.create({
        company: companyId,
        client: clientId,
        receiptDate: new Date(),
        reference: 'RCP-2024-00003',
        amountReceived: 1100.00,
        currencyCode: 'USD',
        bankAccount: bankAccountId,
        paymentMethod: 'cash',
        status: 'posted',
        notes: 'Test receipt for allocation',
        createdBy: userId
      });
      receiptId = receipt._id;
    });

    it('should allocate receipt to invoice', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/ar/allocations')
        .send({
          receipt: receiptId,
          invoice: invoiceId,
          amount: 1100.00,
          allocationDate: new Date()
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      
      // Verify invoice amount_paid increased
      const invoice = await Invoice.findById(invoiceId);
      expect(invoice.amountPaid.toString()).toBe('1100.00');
      expect(invoice.amountOutstanding.toString()).toBe('0.00');
    });

    it('should update invoice amount_paid for partial allocation', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/ar/allocations')
        .send({
          receipt: receiptId,
          invoice: invoiceId,
          amount: 500.00,
          allocationDate: new Date()
        });

      expect(res.status).toBe(201);
      
      // Verify invoice amount_paid increased
      const invoice = await Invoice.findById(invoiceId);
      expect(invoice.amountPaid.toString()).toBe('500.00');
      expect(invoice.amountOutstanding.toString()).toBe('600.00');
    });

    it('should reject allocation exceeding invoice outstanding', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/ar/allocations')
        .send({
          receipt: receiptId,
          invoice: invoiceId,
          amount: 2000.00, // More than outstanding
          allocationDate: new Date()
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('ALLOCATION_EXCEEDS_OUTSTANDING');
    });

    it('should reject allocation exceeding receipt available amount', async () => {
      // Create a smaller receipt
      const smallReceipt = await ARReceipt.create({
        company: companyId,
        client: clientId,
        receiptDate: new Date(),
        reference: 'RCP-2024-00004',
        amountReceived: 100.00,
        currencyCode: 'USD',
        bankAccount: bankAccountId,
        paymentMethod: 'cash',
        status: 'posted',
        notes: 'Small receipt',
        createdBy: userId
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/ar/allocations')
        .send({
          receipt: smallReceipt._id,
          invoice: invoiceId,
          amount: 500.00, // More than receipt amount
          allocationDate: new Date()
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('ALLOCATION_EXCEEDS_RECEIPT');
    });
  });

  describe('GET /api/ar/aging - Aging Report', () => {
    beforeEach(async () => {
      // Create invoices with different due dates
      const now = new Date();
      
      // Current invoice
      await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: now,
        dueDate: now,
        invoiceNumber: 'INV-2024-00010',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 1000.00,
        taxAmount: 100.00,
        totalAmount: 1100.00,
        amountPaid: 0,
        amountOutstanding: 1100.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: 'Current line',
          qty: 1,
          unitPrice: 1000.00,
          taxRate: 10,
          lineTotal: 1100.00
        }]
      });

      // 15 days overdue
      await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: new Date(now - 45 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now - 15 * 24 * 60 * 60 * 1000),
        invoiceNumber: 'INV-2024-00011',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 500.00,
        taxAmount: 50.00,
        totalAmount: 550.00,
        amountPaid: 0,
        amountOutstanding: 550.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: '15 days overdue',
          qty: 1,
          unitPrice: 500.00,
          taxRate: 10,
          lineTotal: 550.00
        }]
      });

      // 45 days overdue
      await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: new Date(now - 75 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now - 45 * 24 * 60 * 60 * 1000),
        invoiceNumber: 'INV-2024-00012',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 300.00,
        taxAmount: 30.00,
        totalAmount: 330.00,
        amountPaid: 0,
        amountOutstanding: 330.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: '45 days overdue',
          qty: 1,
          unitPrice: 300.00,
          taxRate: 10,
          lineTotal: 330.00
        }]
      });
    });

    it('should return aging report with correct buckets', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/ar/aging');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      const aging = res.body.data;
      // Find the client in aging
      const clientAging = aging.find(a => a.client._id.toString() === clientId.toString());
      expect(clientAging).toBeDefined();
      
      // Check buckets
      expect(parseFloat(clientAging.current)).toBe(1100.00);
      expect(parseFloat(clientAging.days15)).toBe(550.00);
      expect(parseFloat(clientAging.days30)).toBe(0);
      expect(parseFloat(clientAging.days45)).toBe(330.00);
      expect(parseFloat(clientAging.days60Plus)).toBe(0);
    });
  });

  describe('POST /api/ar/bad-debts - Bad Debt Write-off', () => {
    let invoiceId;

    beforeEach(async () => {
      // Create fully overdue invoice
      const invoice = await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        dueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        invoiceNumber: 'INV-2024-00020',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 1000.00,
        taxAmount: 100.00,
        totalAmount: 1100.00,
        amountPaid: 0,
        amountOutstanding: 1100.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: 'Bad debt line',
          qty: 1,
          unitPrice: 1000.00,
          taxRate: 10,
          lineTotal: 1100.00
        }]
      });
      invoiceId = invoice._id;
    });

    it('should create and post bad debt write-off', async () => {
      const app = createApp();
      
      // Create write-off
      const createRes = await request(app)
        .post('/api/ar/bad-debts')
        .send({
          invoiceId: invoiceId,
          writeoffDate: new Date(),
          amount: 1100.00,
          reason: 'Customer bankruptcy',
          notes: 'BDW test'
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.status).toBe('draft');
      
      const writeoffId = createRes.body.data._id;
      
      // Post write-off
      const postRes = await request(app)
        .post(`/api/ar/bad-debts/${writeoffId}/post`);

      expect(postRes.status).toBe(200);
      expect(postRes.body.data.status).toBe('posted');
      
      // Verify journal entries
      const journals = await JournalEntry.find({ reference: 'BDW-2024-00001' });
      expect(journals).toHaveLength(2);
      
      const drEntry = journals.find(j => j.debitTotal > 0);
      const crEntry = journals.find(j => j.creditTotal > 0);
      expect(drEntry.debitTotal).toBe(1100.00);
      expect(crEntry.creditTotal).toBe(1100.00);
    });
  });

  describe('POST /api/ar/receipts/:id/reverse - Reverse Receipt', () => {
    let receiptId, invoiceId;

    beforeEach(async () => {
      // Create invoice
      const invoice = await Invoice.create({
        company: companyId,
        client: clientId,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        invoiceNumber: 'INV-2024-00030',
        status: 'confirmed',
        currencyCode: 'USD',
        subtotal: 1000.00,
        taxAmount: 100.00,
        totalAmount: 1100.00,
        amountPaid: 0,
        amountOutstanding: 1100.00,
        createdBy: userId,
        lines: [{
          product: new mongoose.Types.ObjectId(),
          description: 'Test line',
          qty: 1,
          unitPrice: 1000.00,
          taxRate: 10,
          lineTotal: 1100.00
        }]
      });
      invoiceId = invoice._id;

      // Create and post receipt
      const receipt = await ARReceipt.create({
        company: companyId,
        client: clientId,
        receiptDate: new Date(),
        reference: 'RCP-2024-00030',
        amountReceived: 1100.00,
        currencyCode: 'USD',
        bankAccount: bankAccountId,
        paymentMethod: 'cash',
        status: 'posted',
        notes: 'Receipt to reverse',
        createdBy: userId
      });
      receiptId = receipt._id;

      // Allocate receipt to invoice
      await ARReceiptAllocation.create({
        company: companyId,
        receipt: receiptId,
        invoice: invoiceId,
        amountAllocated: 1100.00,
        createdBy: userId
      });

      // Update invoice
      invoice.amountPaid = 1100.00;
      invoice.amountOutstanding = 0;
      await invoice.save();
    });

    it('should reverse a posted receipt and reinstate invoice', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/ar/receipts/${receiptId}/reverse`)
        .send({
          reversalDate: new Date(),
          reversalReason: 'Customer returned payment'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reversed');
      
      // Verify invoice is reinstated
      const invoice = await Invoice.findById(invoiceId);
      expect(invoice.amountPaid.toString()).toBe('0.00');
      expect(invoice.amountOutstanding.toString()).toBe('1100.00');
    });
  });
});
