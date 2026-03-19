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

const buildApp = (companyId) => {
  const app = express();
  app.use(express.json());
  const wc = require('../controllers/warehouseController');
  const sc = require('../controllers/stockController');
  // Mock auth
  app.use((req, res, next) => {
    req.user = { id: new mongoose.Types.ObjectId(), company: { _id: companyId || new mongoose.Types.ObjectId() } };
    next();
  });

  app.put('/api/stock/warehouses/:id', wc.updateWarehouse);
  app.post('/api/stock/adjust', sc.adjustStock);

  return app;
};

test('Deactivating a warehouse with stock returns 409/Warehouse_HAS_STOCK', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');

  const warehouse = await Warehouse.create({ company: companyId, name: 'WH-HasStock', isActive: true });
  const product = await Product.create({ company: companyId, name: 'ProdA', sku: 'PA-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000' });

  await InventoryBatch.create({ company: companyId, product: product._id, warehouse: warehouse._id, quantity: 10, availableQuantity: 10, unitCost: 5, totalCost: 50 });

  const res = await request(app).put(`/api/stock/warehouses/${warehouse._id}`).send({ isActive: false }).expect(409);
  expect(res.body.success).toBe(false);
  expect(res.body.code).toBe('WAREHOUSE_HAS_STOCK');
});

test('Stock adjustment posts inventory to product inventory account when warehouse missing account', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const JournalEntry = require('../models/JournalEntry');

  const warehouse = await Warehouse.create({ company: companyId, name: 'WH-NoAcct', isActive: true });
  const product = await Product.create({ company: companyId, name: 'ProdB', sku: 'PB-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000', averageCost: 10, currentStock: 0 });

  // Perform an IN adjustment with warehouse specified
  const res = await request(app).post('/api/stock/adjust').send({ product: product._id, quantity: 2, reason: 'correction', type: 'in', warehouse: warehouse._id });
  if (res.status !== 201) {
    console.error('Debug adjustStock response:', res.status, res.body, res.text);
  }
  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);

  // Check journal entry created for stock_adjustment source
  const je = await JournalEntry.findOne({ company: companyId, sourceType: 'stock_adjustment' }).lean();
  expect(je).toBeDefined();
  // Debit line should be to product.inventoryAccount ('1400') due to warehouse having no inventoryAccount
  const debitLine = je.lines.find(l => (l.debit || 0) > 0);
  expect(debitLine).toBeDefined();
  expect(debitLine.accountCode).toBe('1400');
});
