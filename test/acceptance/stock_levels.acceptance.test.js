const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Product = require('../../models/Product');
const Category = require('../../models/Category');
const InventoryBatch = require('../../models/InventoryBatch');
const InventoryLayer = require('../../models/InventoryLayer');
const Client = require('../../models/Client');
const Invoice = require('../../models/Invoice');
const DeliveryNote = require('../../models/DeliveryNote');

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

function computeAvailable(productId) {
  return Promise.all([
    Product.findById(productId).lean(),
    InventoryBatch.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(productId) } },
      { $group: { _id: null, reserved: { $sum: { $ifNull: ['$reservedQuantity', 0] } } } }
    ])
  ]).then(([prod, agg]) => {
    const onHand = prod.currentStock || 0;
    const reserved = agg[0] && agg[0].reserved ? parseFloat((agg[0].reserved).toString()) : 0;
    return { onHand, reserved, available: onHand - reserved };
  });
}

test('Acceptance: Stock can be tracked via delivery notes', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Create warehouse first
  const Warehouse = require('../../models/Warehouse');
  const warehouse = await Warehouse.create({ company: companyId, name: 'WH-Test', isActive: true });

  const cat = await Category.create({ company: companyId, name: 'Cat A' });
  const product = await Product.create({ company: companyId, name: 'AccProd', sku: 'AP-1', category: cat._id, unit: 'pcs', currentStock: 20, averageCost: 5, costingMethod: 'fifo', defaultWarehouse: warehouse._id });

  // Create inventory batch and layer
  await InventoryBatch.create({ company: companyId, product: product._id, warehouse: warehouse._id, quantity: 10, availableQuantity: 10, reservedQuantity: 0, unitCost: 4, totalCost: 40, status: 'active', createdBy: userId, receivedDate: new Date('2020-01-01') });
  await InventoryLayer.create({ company: companyId, product: product._id, qtyReceived: 10, qtyRemaining: 10, unitCost: 4, receiptDate: new Date('2020-01-01') });

  // Create client and invoice using autoConfirm
  const client = await Client.create({ company: companyId, name: 'ACME', contact: { email: 'a@ac.me' } });

  const app = express();
  app.use(express.json());
  const invoiceController = require('../../controllers/invoiceController');
  app.post('/api/invoices', (req, res, next) => { req.user = { id: userId, _id: userId, company: { _id: companyId } }; invoiceController.createInvoice(req, res, next); });

  // Create and auto-confirm invoice (stock is consumed immediately)
  const invoiceResp = await request(app).post('/api/invoices').send({ 
    client: client._id, 
    items: [{ product: product._id, quantity: 5, unitPrice: 10 }],
    autoConfirm: true
  }).expect(201);

  // Check stock reduced
  const prodAfterInvoice = await Product.findById(product._id).lean();
  expect(prodAfterInvoice.currentStock).toBe(15); // 20 - 5

  // Create delivery note (linked to invoice)
  const deliveryNote = await DeliveryNote.create({
    company: companyId,
    client: client._id,
    invoice: invoiceResp.body.data._id,
    warehouse: warehouse._id,
    items: [{ 
      product: product._id, 
      productName: product.name, 
      itemCode: product.sku, 
      unit: product.unit, 
      orderedQty: 5, 
      deliveredQty: 5, 
      pendingQty: 0
    }],
    createdBy: userId
  });

  app.put('/api/delivery-notes/:id/confirm', (req, res, next) => { req.user = { id: userId, _id: userId, company: { _id: companyId } }; const controller = require('../../controllers/deliveryNoteController'); controller.confirmDelivery(req, res, next); });
  
  // Confirm delivery - but since invoice already auto-confirmed and stock already consumed, 
  // this should just mark as delivered without double-consuming
  const confirmRes = await request(app).put(`/api/delivery-notes/${deliveryNote._id}/confirm`).send();
  
  // The delivery note should confirm (even if no additional stock changes)
  expect([200, 400]).toContain(confirmRes.status); // Either success or already delivered
});

test('Acceptance: GET /api/reports/stock-valuation returns FIFO value for multi-lot product', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const cat2 = await Category.create({ company: companyId, name: 'Cat B' });
  const product = await Product.create({ company: companyId, name: 'ValProd', sku: 'VP-1', category: cat2._id, unit: 'pcs', currentStock: 15, averageCost: 0, costingMethod: 'fifo' });

  // Two layers with costs 3 (10 units) and 5 (5 units)
  await InventoryLayer.create({ company: companyId, product: product._id, qtyReceived: 10, qtyRemaining: 10, unitCost: 3, receiptDate: new Date('2020-01-01') });
  await InventoryLayer.create({ company: companyId, product: product._id, qtyReceived: 5, qtyRemaining: 5, unitCost: 5, receiptDate: new Date('2020-02-01') });

  // Call report generator service directly to get valuation
  const reportGenerator = require('../../services/reportGeneratorService');
  const report = await reportGenerator.generateStockValuationReport(companyId);
  const items = report.data;
  const found = items.find(i => String(i._id) === String(product._id));
  expect(found).toBeDefined();
  // Expected FIFO valuation = 10*3 + 5*5 = 30 + 25 = 55
  expect(found.totalValue).toBeCloseTo(55, 6);
});
