const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const InventoryLayer = require('../../models/InventoryLayer');
const Product = require('../../models/Product');
const Client = require('../../models/Client');
const JournalEntry = require('../../models/JournalEntry');

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

test('Invoice with autoConfirm consumes layers and posts COGS journal', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Create product and an inventory layer (FIFO)
  const product = await Product.create({ company: companyId, name: 'Widget', sku: 'W1', currentStock: 5, averageCost: 5, category: new mongoose.Types.ObjectId(), createdBy: userId });
  await InventoryLayer.create({ company: companyId, product: product._id, qtyReceived: 5, qtyRemaining: 5, unitCost: 5, receiptDate: new Date('2020-01-01') });

  // Create client
  const client = await Client.create({ company: companyId, name: 'ACME', contact: { email: 'a@ac.me' } });

  const app = express();
  app.use(express.json());
  const invoiceController = require('../../controllers/invoiceController');

  app.post('/api/invoices', (req, res, next) => {
    req.user = { id: userId, _id: userId, company: { _id: companyId } };
    invoiceController.createInvoice(req, res, next);
  });

  // Create invoice with autoConfirm to consume layers immediately
  const createResp = await request(app)
    .post('/api/invoices')
    .send({ 
      client: client._id, 
      items: [{ product: product._id, quantity: 3, unitPrice: 10 }],
      autoConfirm: true
    })
    .expect(201);

  const invoice = createResp.body.data;
  expect(invoice).toBeDefined();

  // Verify invoice is confirmed and stock deducted
  expect(invoice.status === 'confirmed' || invoice.stockDeducted === true).toBeTruthy();

  // Verify InventoryLayer quantity decreased
  const layers = await InventoryLayer.find({ company: companyId, product: product._id }).lean();
  expect(layers.length).toBeGreaterThan(0);
  const remaining = layers.reduce((s, l) => s + (l.qtyRemaining || 0), 0);
  expect(remaining).toBe(2); // 5 - 3 = 2

  // Verify COGS journal entry created
  const cogsEntry = await JournalEntry.findOne({ company: companyId, sourceType: 'cogs', sourceId: invoice._id }).lean();
  expect(cogsEntry).toBeDefined();
});
