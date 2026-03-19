const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });
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

test('GET /api/accounting/health returns healthy when journals balanced and stock reconciles', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const accountingController = require('../../controllers/accountingController');

  app.get('/api/accounting/health', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    accountingController.healthCheck(req, res, next);
  });

  const JournalEntry = require('../../models/JournalEntry');
  const Product = require('../../models/Product');
  const InventoryBatch = require('../../models/InventoryBatch');

  // Create a balanced posted journal entry
  await JournalEntry.create({
    company: companyId,
    entryNumber: 'JE-TEST-0001',
    date: new Date(),
    description: 'Balanced entry',
    lines: [
      { accountCode: '1300', accountName: 'Inv', debit: 100, credit: 0 },
      { accountCode: '2100', accountName: 'Pay', debit: 0, credit: 100 }
    ],
    status: 'posted',
    createdBy: userId
  });

  // Create product and matching batch
  const prod = await Product.create({ company: companyId, name: 'P-A', sku: 'PA-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', currentStock: 10 });
  await InventoryBatch.create({ company: companyId, product: prod._id, warehouse: new mongoose.Types.ObjectId(), quantity: 10, availableQuantity: 10, unitCost: 5, totalCost: 50, status: 'active', createdBy: userId });

  const res = await request(app).get('/api/accounting/health').expect(200);
  expect(res.body.success).toBe(true);
  expect(res.body.healthy).toBe(true);
  expect(res.body.journal.healthy).toBe(true);
  expect(res.body.stock.healthy).toBe(true);
});

test('GET /api/accounting/health reports issues when journals unbalanced and stock mismatches', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const accountingController = require('../../controllers/accountingController');
  app.get('/api/accounting/health', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    accountingController.healthCheck(req, res, next);
  });

  const Product = require('../../models/Product');
  const InventoryBatch = require('../../models/InventoryBatch');

  // Insert a malformed/unbalanced journal entry directly into collection (bypass Mongoose validation)
  await mongoose.connection.collection('journalentries').insertOne({
    company: companyId,
    entryNumber: 'JE-CORRUPT-0001',
    date: new Date(),
    description: 'Corrupt unbalanced',
    lines: [ { accountCode: '1300', accountName: 'Inv', debit: 100, credit: 0 } ],
    totalDebit: 100,
    totalCredit: 50,
    status: 'posted',
    createdBy: userId
  });

  // Create product with mismatched currentStock vs batches
  const prod = await Product.create({ company: companyId, name: 'P-B', sku: 'PB-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', currentStock: 5 });
  await InventoryBatch.create({ company: companyId, product: prod._id, warehouse: new mongoose.Types.ObjectId(), quantity: 2, availableQuantity: 2, unitCost: 5, totalCost: 10, status: 'active', createdBy: userId });

  const res = await request(app).get('/api/accounting/health').expect(200);
  expect(res.body.success).toBe(true);
  expect(res.body.healthy).toBe(false);
  expect(res.body.journal.healthy).toBe(false);
  expect(res.body.stock.healthy).toBe(false);
  expect(res.body.stock.discrepanciesCount).toBeGreaterThanOrEqual(1);
});
