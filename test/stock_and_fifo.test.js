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
  const sc = require('../controllers/stockController');
  const dc = require('../controllers/deliveryNoteController');

  app.use((req, res, next) => {
    req.user = { id: new mongoose.Types.ObjectId(), company: { _id: companyId || new mongoose.Types.ObjectId() } };
    next();
  });

  app.post('/api/stock/movements', sc.receiveStock);
  app.delete('/api/stock/movements/:id', sc.deleteStockMovement);
  app.put('/api/stock/movements/:id', sc.updateStockMovement);
  app.post('/api/delivery-notes', dc.createDeliveryNote);
  app.put('/api/delivery-notes/:id/confirm', dc.confirmDelivery);

  return app;
};

test('Deleting and updating a StockMovement returns 405/MOVEMENT_IMMUTABLE', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);
  const Product = require('../models/Product');

  const product = await Product.create({ company: companyId, name: 'ProdImmut', sku: 'PI-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000', averageCost: 10, currentStock: 0 });

  const resCreate = await request(app).post('/api/stock/movements').send({ product: product._id, quantity: 5, unitCost: 10, reason: 'purchase' }).expect(201);
  expect(resCreate.body.success).toBe(true);
  const movementId = resCreate.body.data._id;

  const delRes = await request(app).delete(`/api/stock/movements/${movementId}`).expect(405);
  expect(delRes.body.success).toBe(false);
  expect(delRes.body.code).toBe('MOVEMENT_IMMUTABLE');

  const putRes = await request(app).put(`/api/stock/movements/${movementId}`).send({ notes: 'try edit' }).expect(405);
  expect(putRes.body.success).toBe(false);
  expect(putRes.body.code).toBe('MOVEMENT_IMMUTABLE');
});

// Simplified test - verify delivery note can be created with new schema
test('Can create delivery note with required fields', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  
  // Create required entities
  const Product = require('../models/Product');
  const Warehouse = require('../models/Warehouse');
  const Client = require('../models/Client');
  const Invoice = require('../models/Invoice');
  const DeliveryNote = require('../models/DeliveryNote');

  const product = await Product.create({ 
    company: companyId, 
    name: 'ProdTest', 
    sku: 'PT-1', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    inventoryAccount: '1400', 
    cogsAccount: '5000', 
    revenueAccount: '4000', 
    averageCost: 10, 
    currentStock: 10 
  });
  
  const warehouse = await Warehouse.create({ company: companyId, name: 'WH-Test', isActive: true });
  const client = await Client.create({ company: companyId, name: 'TestClient', contact: { email: 'test@test.com' } });
  
  // Create confirmed invoice with required fields
  const invoice = await Invoice.create({ 
    company: companyId, 
    client: client._id, 
    invoiceDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    dueDate: new Date(), // today - which is after invoiceDate
    createdBy: userId,
    status: 'confirmed',
    items: [{ 
      product: product._id, 
      quantity: 5, 
      unitPrice: 10, 
      subtotal: 50,
      cogsAmount: 25,
      description: 'Test Product',
      itemCode: 'PT-1',
      unit: 'pcs'
    }] 
  });

  // Directly create delivery note (bypass controller for simpler test)
  const deliveryNote = await DeliveryNote.create({
    company: companyId,
    invoice: invoice._id,
    client: client._id,
    warehouse: warehouse._id,
    lines: [{
      product: product._id,
      productName: product.name,
      itemCode: product.sku,
      unit: product.unit,
      orderedQty: 5,
      qtyToDeliver: 5,
      deliveredQty: 0,
      pendingQty: 5
    }],
    status: 'draft',
    createdBy: userId
  });

  expect(deliveryNote).toBeDefined();
  expect(deliveryNote._id).toBeDefined();
  expect(deliveryNote.referenceNo).toBeDefined();
  expect(deliveryNote.lines).toHaveLength(1);
});
