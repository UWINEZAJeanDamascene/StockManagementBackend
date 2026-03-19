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

test('Confirming a GRN updates stock, creates batch, posts JE and updates PO status', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const purchaseOrderController = require('../../controllers/purchaseOrderController');
  const grnController = require('../../controllers/grnController');
  const Product = require('../../models/Product');
  const Category = require('../../models/Category');
  const Supplier = require('../../models/Supplier');
  const Warehouse = require('../../models/Warehouse');
  const PurchaseOrder = require('../../models/PurchaseOrder');
  const GoodsReceivedNote = require('../../models/GoodsReceivedNote');
  const InventoryBatch = require('../../models/InventoryBatch');
  const JournalEntry = require('../../models/JournalEntry');

  // Routes used in test
  app.post('/api/purchase-orders', (req, res, next) => {
    req.user = { _id: userId, id: userId, company: { _id: companyId } };
    purchaseOrderController.createPurchaseOrder(req, res, next);
  });

  app.post('/api/purchase-orders/:id/approve', (req, res, next) => {
    req.user = { _id: userId, id: userId, company: { _id: companyId } };
    purchaseOrderController.approvePurchaseOrder(req, res, next);
  });

  app.post('/api/grn', (req, res, next) => {
    req.user = { _id: userId, id: userId, company: { _id: companyId } };
    grnController.createGRN(req, res, next);
  });

  app.post('/api/grn/:id/confirm', (req, res, next) => {
    req.user = { _id: userId, id: userId, company: { _id: companyId } };
    grnController.confirmGRN(req, res, next);
  });

  // Error handler to surface controller errors in tests
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('Test error:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: err && err.message ? err.message : 'Internal Server Error' });
  });

  // Create minimal supporting data
  const cat = await Category.create({ company: companyId, name: 'POCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Acme Supplies' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Main WH' });

  // Create a FIFO product
  const prod = await Product.create({ company: companyId, name: 'Widget', sku: 'W-1', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 0 });

  // Create a PO with one line
  const poResp = await request(app)
    .post('/api/purchase-orders')
    .send({ referenceNo: 'PO-001', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 10, unitCost: 5, taxRate: 10 }] })
    .expect(201);

  const po = poResp.body.data;
  expect(po).toBeTruthy();

  // Approve PO
  await request(app)
    .post(`/api/purchase-orders/${po._id}/approve`)
    .expect(200);

  // Create GRN receiving 5 units
  const grnResp = await request(app)
    .post('/api/grn')
    .send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-001', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 5, unitCost: 5 }] })
    .expect(201);

  const grn = grnResp.body.data;
  expect(grn).toBeTruthy();

  // Confirm GRN
  const confirmResp = await request(app)
    .post(`/api/grn/${grn._id}/confirm`)
    .expect(200);

  expect(confirmResp.body.success).toBe(true);

  // Reload product and assert stock increased
  const reprod = await Product.findById(prod._id).lean();
  expect(reprod.currentStock).toBe(5);

  // Inventory batch created
  const batch = await InventoryBatch.findOne({ company: companyId, product: prod._id });
  expect(batch).toBeTruthy();
  expect(batch.quantity).toBe(5);
  expect(batch.unitCost).toBe(5);

  // Journal entry exists and balanced
  const je = await JournalEntry.findOne({ company: companyId, sourceType: 'purchase_order', sourceId: po._id }).lean();
  expect(je).toBeTruthy();
  expect(Math.abs(je.totalDebit - je.totalCredit)).toBeLessThanOrEqual(0.01);

  // PO line qtyReceived updated and PO status partially_received
  const updatedPO = await PurchaseOrder.findById(po._id).lean();
  expect(updatedPO.lines[0].qtyReceived).toBe(5);
  expect(['partially_received', 'fully_received']).toContain(updatedPO.status);
});
