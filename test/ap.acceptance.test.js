const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const APPayment = require('../models/APPayment');
const APPaymentAllocation = require('../models/APPaymentAllocation');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const Supplier = require('../models/Supplier');
const Company = require('../models/Company');
const User = require('../models/User');
const { BankAccount } = require('../models/BankAccount');
const AccountMapping = require('../models/AccountMapping');
const JournalEntry = require('../models/JournalEntry');
const PurchaseOrder = require('../models/PurchaseOrder');
const Warehouse = require('../models/Warehouse');
const Product = require('../models/Product');
const Category = require('../models/Category');

let mongoServer;
let companyId, userId, supplierId, bankAccountId, warehouseId, productId;
let apController;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  // Create company
  const company = await Company.create({
    name: 'Test Company AP',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@company-ap.com'
  });
  companyId = company._id;

  // Create user
  const user = await User.create({
    name: 'Test User AP',
    email: `test-ap-${Date.now()}@example.com`,
    password: 'password123',
    company: companyId,
    role: 'admin'
  });
  userId = user._id;

  // Create warehouse
  const warehouse = await Warehouse.create({
    company: companyId,
    name: 'Main Warehouse',
    code: 'WH001',
    isActive: true
  });
  warehouseId = warehouse._id;

  // Create category
  const category = await Category.create({
    company: companyId,
    name: 'Test Category'
  });

  // Create product
  const product = await Product.create({
    company: companyId,
    name: 'Test Product',
    sku: 'TP-AP-001',
    category: category._id,
    unit: 'pcs',
    currentStock: 100,
    isActive: true,
    averageCost: 10,
    sellingPrice: 20,
    costingMethod: 'fifo'
  });
  productId = product._id;

  // Create supplier
  const supplier = await Supplier.create({
    company: companyId,
    name: 'Test Supplier AP',
    code: 'SUP-AP-001',
    contact: { email: 'supplier-ap@test.com' }
  });
  supplierId = supplier._id;

  // Create purchase order
  const po = await PurchaseOrder.create({
    company: companyId,
    referenceNo: 'PO-AP-00001',
    supplier: supplierId,
    warehouse: warehouseId,
    orderDate: new Date(),
    status: 'approved',
    currencyCode: 'USD',
    lines: [{
      product: productId,
      qtyOrdered: 10,
      qtyReceived: 10,
      unitCost: 100,
      taxRate: 0,
      lineTotal: 1000
    }],
    subtotal: 1000,
    taxAmount: 0,
    totalAmount: 1000
  });

  // Create bank account
  const bankAccount = await BankAccount.create({
    company: companyId,
    name: 'Test Bank Account AP',
    accountNumber: '1234567890',
    accountType: 'bk_bank',
    accountCode: '1100',
    balance: 0,
    openingBalanceDate: new Date(),
    isActive: true,
    currency: 'USD'
  });
  bankAccountId = bankAccount._id;

  // Create account mappings for AP (module='purchases', key='accountsPayable')
  await AccountMapping.create({
    company: companyId,
    module: 'purchases',
    key: 'accountsPayable',
    accountCode: '2100',
    description: 'Accounts Payable'
  });

  // Create GRN with total amount and balance
  const grn = await GoodsReceivedNote.create({
    company: companyId,
    referenceNo: 'GRN-2024-00001',
    purchaseOrder: po._id,
    warehouse: warehouseId,
    supplier: supplierId,
    receivedDate: new Date(),
    status: 'confirmed',
    totalAmount: mongoose.Types.Decimal128.fromString('1000.00'),
    balance: mongoose.Types.Decimal128.fromString('1000.00'),
    amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
    paymentStatus: 'pending',
    paymentDueDate: new Date(),
    lines: [{
      product: productId,
      qtyReceived: 10,
      unitCost: 100
    }]
  });

  // Create another GRN with due date in the past (for aging test)
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 45);
  
  const grn2 = await GoodsReceivedNote.create({
    company: companyId,
    referenceNo: 'GRN-2024-00002',
    purchaseOrder: po._id,
    warehouse: warehouseId,
    supplier: supplierId,
    receivedDate: pastDate,
    status: 'confirmed',
    totalAmount: mongoose.Types.Decimal128.fromString('500.00'),
    balance: mongoose.Types.Decimal128.fromString('500.00'),
    amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
    paymentStatus: 'pending',
    paymentDueDate: pastDate,
    lines: [{
      product: productId,
      qtyReceived: 5,
      unitCost: 100
    }]
  });

  // Load controller
  apController = require('../controllers/apController');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  // Preserve baseline reference data created in beforeAll (company, supplier, products, PO, GRNs, etc.)
  const preserve = new Set([
    'companies', 'users', 'warehouses', 'categories', 'products', 'suppliers',
    'purchaseorders', 'bankaccounts', 'accountmappings', 'goodsreceivednotes', 'sequences'
  ]);
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    if (preserve.has(name)) continue;
    try {
      await mongoose.connection.collections[name].deleteMany({});
    } catch (e) {
      // ignore
    }
  }
});

// Helper to create express app with AP routes using mock auth
function createApp() {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware
  app.use((req, res, next) => {
    req.user = { 
      id: userId, 
      _id: userId, 
      company: { _id: companyId } 
    };
    next();
  });

  // Mount routes
  app.get('/api/ap/payments', (req, res, next) => apController.getPayments(req, res, next));
  app.post('/api/ap/payments', (req, res, next) => apController.createPayment(req, res, next));
  app.get('/api/ap/payments/:id', (req, res, next) => apController.getPayment(req, res, next));
  app.put('/api/ap/payments/:id', (req, res, next) => apController.updatePayment(req, res, next));
  app.post('/api/ap/payments/:id/post', (req, res, next) => apController.postPayment(req, res, next));
  app.post('/api/ap/payments/:id/reverse', (req, res, next) => apController.reversePayment(req, res, next));
  
  app.get('/api/ap/allocations', (req, res, next) => apController.getAllocations(req, res, next));
  app.post('/api/ap/allocations', (req, res, next) => apController.createAllocation(req, res, next));
  
  app.get('/api/ap/aging', (req, res, next) => apController.getAgingReport(req, res, next));

  return app;
}

describe('Accounts Payable API', () => {
  
  describe('POST /api/ap/payments - Create Payment', () => {
    it('should create a draft payment', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 1000.00,
          currencyCode: 'USD'
        });

      

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('draft');
    });
  });

  describe('POST /api/ap/payments/:id/post - Post Payment', () => {
    let grnId;

    beforeEach(async () => {
      // Get the first GRN
      const grn = await GoodsReceivedNote.findOne({ referenceNo: 'GRN-2024-00001' });
      grnId = grn._id;
    });

    it('should post a payment and create journal entry - DR AP / CR Bank balanced', async () => {
      const app = createApp();
      
      // Create and allocate payment
      const createRes = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 1000.00,
          currencyCode: 'USD',
          allocations: [{
            grnId: grnId,
            amountAllocated: 1000.00
          }]
        });

      expect(createRes.status).toBe(201);
      const paymentId = createRes.body.data._id;

      // Post payment
      const postRes = await request(app)
        .post(`/api/ap/payments/${paymentId}/post`);

      expect(postRes.status).toBe(200);
      expect(postRes.body.data.status).toBe('posted');
      
      // Verify journal entries were created
      const journals = await JournalEntry.find({ reference: postRes.body.data.referenceNo });
      // One journal entry with both debit and credit lines
      expect(journals).toHaveLength(1);
      const journal = journals[0];
      
      // Should have DR AP (2100) and CR Bank (1100) in the same entry
      expect(Number(journal.totalDebit)).toBe(1000.00);
      expect(Number(journal.totalCredit)).toBe(1000.00);
      
      // Verify DR account is 2100 (AP)
      const apLine = journal.lines.find(l => l.accountCode === '2100');
      expect(apLine).toBeDefined();
      expect(Number(apLine.debit)).toBe(1000.00);
      
      // Verify CR account is 1100 (Bank)
      const bankLine = journal.lines.find(l => l.accountCode === '1100');
      expect(bankLine).toBeDefined();
      expect(Number(bankLine.credit)).toBe(1000.00);
    });

    it('should not allow posting a posted payment', async () => {
      const app = createApp();
      
      // Create payment
      const createRes = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 500.00,
          currencyCode: 'USD'
        });

      const paymentId = createRes.body.data._id;

      // Post first time
      await request(app).post(`/api/ap/payments/${paymentId}/post`);

      // Try to post again
      const postRes = await request(app)
        .post(`/api/ap/payments/${paymentId}/post`);

      expect(postRes.status).toBe(400);
    });
  });

  describe('POST /api/ap/allocations - Allocate Payment to GRN', () => {
    let grnId;

    beforeEach(async () => {
      // Get the first GRN
      const grn = await GoodsReceivedNote.findOne({ referenceNo: 'GRN-2024-00001' });
      
      // Reset GRN balance
      grn.balance = mongoose.Types.Decimal128.fromString('1000.00');
      grn.amountPaid = mongoose.Types.Decimal128.fromString('0.00');
      grn.paymentStatus = 'pending';
      await grn.save();
      
      grnId = grn._id;
    });

    it('should allocate to a GRN and mark it as paid when fully covered', async () => {
      const app = createApp();
      
      // Create payment
      const createRes = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 1000.00,
          currencyCode: 'USD'
        });

      expect(createRes.status).toBe(201);
      const paymentId = createRes.body.data._id;

      // Post payment first
      await request(app).post(`/api/ap/payments/${paymentId}/post`);

      // Now allocate to GRN
      const allocRes = await request(app)
        .post('/api/ap/allocations')
        .send({
          paymentId: paymentId,
          grnId: grnId,
          amount: 1000.00
        });

      expect(allocRes.status).toBe(201);
      
      // Verify GRN is marked as paid
      const updatedGRN = await GoodsReceivedNote.findById(grnId);
      expect(updatedGRN.paymentStatus).toBe('paid');
      expect(parseFloat(updatedGRN.balance)).toBe(0);
      expect(parseFloat(updatedGRN.amountPaid)).toBe(1000.00);
    });

    it('should mark as partially_paid when partially covered', async () => {
      const app = createApp();
      
      // Create payment
      const createRes = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 1000.00,
          currencyCode: 'USD'
        });

      const paymentId = createRes.body.data._id;

      // Post payment
      await request(app).post(`/api/ap/payments/${paymentId}/post`);

      // Allocate only partial amount
      const allocRes = await request(app)
        .post('/api/ap/allocations')
        .send({
          paymentId: paymentId,
          grnId: grnId,
          amount: 500.00
        });

      expect(allocRes.status).toBe(201);
      
      // Verify GRN is marked as partially_paid
      const updatedGRN = await GoodsReceivedNote.findById(grnId);
      expect(updatedGRN.paymentStatus).toBe('partially_paid');
      expect(parseFloat(updatedGRN.balance)).toBe(500.00);
      expect(parseFloat(updatedGRN.amountPaid)).toBe(500.00);
    });
  });

  describe('POST /api/ap/payments/:id/reverse - Reverse Payment', () => {
    let grnId;

    beforeEach(async () => {
      // Get the first GRN
      const grn = await GoodsReceivedNote.findOne({ referenceNo: 'GRN-2024-00001' });
      
      // Reset GRN balance
      grn.balance = mongoose.Types.Decimal128.fromString('1000.00');
      grn.amountPaid = mongoose.Types.Decimal128.fromString('0.00');
      grn.paymentStatus = 'pending';
      await grn.save();
      
      grnId = grn._id;
    });

    it('should reverse a posted payment and reinstate AP balance', async () => {
      const app = createApp();
      
      // Create and post payment
      const createRes = await request(app)
        .post('/api/ap/payments')
        .send({
          supplierId: supplierId,
          paymentDate: new Date(),
          paymentMethod: 'bank_transfer',
          bankAccountId: bankAccountId,
          amountPaid: 1000.00,
          currencyCode: 'USD',
          allocations: [{
            grnId: grnId,
            amountAllocated: 1000.00
          }]
        });

      const paymentId = createRes.body.data._id;
      await request(app).post(`/api/ap/payments/${paymentId}/post`);

      // Reverse payment
      const reverseRes = await request(app)
        .post(`/api/ap/payments/${paymentId}/reverse`)
        .send({
          reason: 'Test reversal'
        });

      expect(reverseRes.status).toBe(200);
      expect(reverseRes.body.data.status).toBe('reversed');
      
      // Verify reversing journal entries were created
      const reverseJournals = await JournalEntry.find({ 
        description: { $regex: /Reversal/ }
      });
      expect(reverseJournals.length).toBeGreaterThan(0);
      
      // Verify GRN balance is reinstated
      const updatedGRN = await GoodsReceivedNote.findById(grnId);
      expect(updatedGRN.paymentStatus).toBe('pending');
      expect(parseFloat(updatedGRN.balance)).toBe(1000.00);
      expect(parseFloat(updatedGRN.amountPaid)).toBe(0);
    });
  });

  describe('GET /api/ap/aging - Aging Report', () => {
    beforeEach(async () => {
      // Reset both GRNs
      const grn1 = await GoodsReceivedNote.findOne({ referenceNo: 'GRN-2024-00001' });
      grn1.balance = mongoose.Types.Decimal128.fromString('1000.00');
      grn1.paymentStatus = 'pending';
      await grn1.save();

      const grn2 = await GoodsReceivedNote.findOne({ referenceNo: 'GRN-2024-00002' });
      grn2.balance = mongoose.Types.Decimal128.fromString('500.00');
      grn2.paymentStatus = 'pending';
      await grn2.save();
    });

    it('should return aging report with correct buckets', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/ap/aging');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      const aging = res.body.data;
      expect(aging.length).toBeGreaterThan(0);
      
      // Find our supplier in aging
      const supplierAging = aging.find(a => a.supplier_name === 'Test Supplier AP');
      expect(supplierAging).toBeDefined();
      
      // Current (not yet due) - GRN-00001 has paymentDueDate = today
      expect(parseFloat(supplierAging.not_yet_due)).toBe(1000.00);
      
      // 31-60 days - GRN-00002 has due date 45 days ago
      expect(parseFloat(supplierAging.days_31_60)).toBe(500.00);
    });

    it('should filter aging by supplier', async () => {
      const app = createApp();
      const res = await request(app)
        .get(`/api/ap/aging?supplier_id=${supplierId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].supplier_name).toBe('Test Supplier AP');
    });
  });
});
