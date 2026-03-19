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

// Ensure models used in populate are registered
require('../../models/User');
require('../../models/Client');

test('Stock audit can be created and posted', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  
  const sac = require('../../controllers/stockAuditController');

  app.use((req, res, next) => {
    const uid = new mongoose.Types.ObjectId();
    req.user = { _id: uid, id: uid, company: { _id: companyId } };
    next();
  });

  // Routes
  app.post('/api/stock-audits', sac.createStockAudit);
  app.post('/api/stock-audits/:id/post', sac.postStockAudit);
  app.put('/api/stock-audits/:id/lines', sac.bulkUpdateLines);

  // Test error handler
  app.use((err, req, res, next) => {
    console.error('TEST ERROR:', err && err.message);
    res.status(err.status || 500).json({ message: err && err.message, stack: err && err.stack });
  });

  const Warehouse = require('../../models/Warehouse');
  const Product = require('../../models/Product');
  const InventoryBatch = require('../../models/InventoryBatch');
  const Category = require('../../models/Category');

  const cat = await Category.create({ company: companyId, name: 'TestCat' });
  
  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'TestWH', 
    code: 'TWH', 
    inventoryAccount: '1400',
    isActive: true 
  });

  const product = await Product.create({ 
    company: companyId, 
    name: 'TestProd', 
    sku: 'TP-001', 
    category: cat._id,
    unit: 'pcs', 
    averageCost: 10, 
    currentStock: 50 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 50, 
    availableQuantity: 50, 
    unitCost: 10, 
    totalCost: 500, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  expect(createRes.body.success).toBe(true);
  const audit = createRes.body.data;
  expect(audit.status).toBe('counting');
  expect(audit.items.length).toBe(1);

  // Update line with counted qty
  await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product._id.toString(), qtyCounted: 55 }
      ]
    })
    .expect(200);

  // Post audit
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`)
    .expect(200);

  expect(postRes.body.success).toBe(true);
  expect(postRes.body.data.status).toBe('posted');
});
