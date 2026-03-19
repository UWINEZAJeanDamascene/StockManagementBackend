const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');

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

// Helper to build app with product routes
const buildApp = (companyId) => {
  const app = express();
  app.use(express.json());
  const pc = require('../controllers/productController');
  // Mock auth using provided companyId
  app.use((req, res, next) => {
    req.user = { id: new mongoose.Types.ObjectId(), company: { _id: companyId || new mongoose.Types.ObjectId() } };
    next();
  });
  app.post('/api/products', pc.createProduct);
  app.get('/api/products/:id', pc.getProduct);
  app.put('/api/products/:id', pc.updateProduct);
  app.delete('/api/products/:id', pc.deleteProduct);
  app.get('/api/products', pc.getProducts);
  return app;
};

test('Creating product with required fields returns 201 and full product', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const payload = {
    sku: 'P-100',
    name: 'Test Product API',
    category: new mongoose.Types.ObjectId(),
    unit: 'pcs',
    inventory_account_id: '1400',
    cogs_account_id: '5000',
    revenue_account_id: '4000'
  };

  const res = await request(app).post('/api/products').send(payload).expect(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data).toBeDefined();
  expect(res.body.data.sku).toBe('P-100');
});

test('Creating product without inventory_account_id returns 422', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const payload = {
    sku: 'P-101',
    name: 'Missing Inventory',
    category: new mongoose.Types.ObjectId(),
    unit: 'pcs',
    cogs_account_id: '5000',
    revenue_account_id: '4000'
  };

  const res = await request(app).post('/api/products').send(payload).expect(422);
  expect(res.body.success).toBe(false);
  expect(res.body.errors).toBeDefined();
  expect(res.body.errors.inventoryAccount).toBeDefined();
});

test('GET /api/products/:id returns current stock summed across warehouses', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);
  // Create product directly for same company
  const prod = await Product.create({
    company: companyId,
    name: 'Stocked', sku: 'ST-1', category: new mongoose.Types.ObjectId(), unit: 'pcs',
    inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000'
  });

  // Create stock movements across two warehouses
  await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'initial_stock', quantity: 10, previousStock: 0, newStock: 10, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });
  await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'purchase', quantity: 5, previousStock: 10, newStock: 15, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });

  const res = await request(app).get(`/api/products/${prod._id}`).expect(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.currentStock).toBe(15);
});

test('Changing costing_method when stock exists returns 409 COSTING_METHOD_LOCKED', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);
  const prod = await Product.create({
    company: companyId,
    name: 'CostLock', sku: 'CL-1', category: new mongoose.Types.ObjectId(), unit: 'pcs',
    inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000'
  });

  // Add a stock movement
  await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'initial_stock', quantity: 1, previousStock: 0, newStock: 1, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });

  // Attempt to change costingMethod
  const res = await request(app).put(`/api/products/${prod._id}`).send({ costingMethod: 'weighted' }).expect(409);
  expect(res.body.code === 'COSTING_METHOD_LOCKED' || /COSTING_METHOD_LOCKED/.test(res.body.message || '')).toBeTruthy();
});

test('Setting isActive=false prevents product from appearing in default product list', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);
  const prod = await Product.create({
    company: companyId,
    name: 'Inactive', sku: 'INACT-1', category: new mongoose.Types.ObjectId(), unit: 'pcs',
    inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000'
  });
  // Soft delete (set isActive false)
  prod.isActive = false;
  await prod.save();

  // Build an app that sets req.user.company to our companyId
  const app2 = express();
  app2.use(express.json());
  app2.use((req, res, next) => { req.user = { id: new mongoose.Types.ObjectId(), company: { _id: companyId } }; next(); });
  const pc = require('../controllers/productController');
  app2.get('/api/products', pc.getProducts);

  const res = await request(app2).get('/api/products').expect(200);
  expect(res.body.success).toBe(true);
  const found = res.body.data.find(p => p._id === String(prod._id));
  expect(found).toBeUndefined();
});

test('Creating product pre-fills accounts from category defaults', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  // Create category with default accounts
  const Category = require('../models/Category');
  const category = await Category.create({ company: companyId, name: 'PrefillCat', defaultInventoryAccount: '1400', defaultCogsAccount: '5000', defaultRevenueAccount: '4000' });

  const payload = {
    sku: 'P-200',
    name: 'Prefill Product',
    category: category._id,
    unit: 'pcs'
    // Note: no inventory_account_id / cogs_account_id / revenue_account_id provided
  };

  const res = await request(app).post('/api/products').send(payload).expect(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data.inventoryAccount).toBe('1400');
  expect(res.body.data.cogsAccount).toBe('5000');
  expect(res.body.data.revenueAccount).toBe('4000');
});
