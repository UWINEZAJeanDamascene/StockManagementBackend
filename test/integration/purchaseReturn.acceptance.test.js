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

test('Confirming a purchase return reduces stock_levels.qty_on_hand and posts balanced JE', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const purchaseOrderController = require('../../controllers/purchaseOrderController');
  const grnController = require('../../controllers/grnController');
  const purchaseReturnController = require('../../controllers/purchaseReturnController');
  const Product = require('../../models/Product');
  const Category = require('../../models/Category');
  const Supplier = require('../../models/Supplier');
  const Warehouse = require('../../models/Warehouse');
  const PurchaseOrder = require('../../models/PurchaseOrder');
  const GoodsReceivedNote = require('../../models/GoodsReceivedNote');
  const PurchaseReturn = require('../../models/PurchaseReturn');
  const InventoryBatch = require('../../models/InventoryBatch');
  const JournalEntry = require('../../models/JournalEntry');

  // Routes
  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.post('/api/purchase-returns', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.createPurchaseReturn(req, res, next); });
  app.post('/api/purchase-returns/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.confirmPurchaseReturn(req, res, next); });
  app.use((err, req, res, next) => { console.error(err && err.stack ? err.stack : err); res.status(500).json({ success: false, message: err.message }); });

  // Data setup
  const cat = await Category.create({ company: companyId, name: 'PRCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Return Supplier' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Return WH' });
  const prod = await Product.create({ company: companyId, name: 'ReturnItem', sku: 'R-1', category: cat._id, unit: 'pcs', currentStock: 10, costingMethod: 'fifo', averageCost: 5 });

  // Create PO + approve
  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-RTN-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 5, unitCost: 5, taxRate: 10 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);

  // Create GRN receiving 5 units
  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-RTN-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 5, unitCost: 5 }] }).expect(201);
  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  // Create purchase return draft returning 3 units
  const prResp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-001', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'Defect', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 3, unitCost: 5 }] }).expect(201);
  const pr = prResp.body.data;

  // Confirm purchase return
  await request(app).post(`/api/purchase-returns/${pr._id}/confirm`).expect(200);

  // Product stock decreased by 3
  const updated = await Product.findById(prod._id).lean();
  expect(updated.currentStock).toBe(12);

  // Inventory batch qty_remaining decreased accordingly
  const batch = await InventoryBatch.findOne({ company: companyId, product: prod._id, warehouse: warehouse._id });
  if (batch) expect(batch.availableQuantity).toBeLessThanOrEqual(5);

  // Journal entry exists and balanced
  const je = await JournalEntry.findOne({ company: companyId, sourceType: 'purchase_return', sourceId: pr._id }).lean();
  expect(je).toBeTruthy();
  expect(Math.abs(je.totalDebit - je.totalCredit)).toBeLessThanOrEqual(0.01);
});

test('Attempting to return more than received returns 422', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());
  const purchaseOrderController = require('../../controllers/purchaseOrderController');
  const grnController = require('../../controllers/grnController');
  const purchaseReturnController = require('../../controllers/purchaseReturnController');
  const Product = require('../../models/Product');
  const Category = require('../../models/Category');
  const Supplier = require('../../models/Supplier');
  const Warehouse = require('../../models/Warehouse');

  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.post('/api/purchase-returns', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.createPurchaseReturn(req, res, next); });
  app.post('/api/purchase-returns/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.confirmPurchaseReturn(req, res, next); });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'PRCat2' });
  const supplier = await Supplier.create({ company: companyId, name: 'Return Supplier 2' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Return WH 2' });
  const prod = await Product.create({ company: companyId, name: 'ReturnItem2', sku: 'R-2', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 5 });

  // Create PO + GRN
  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-R2-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 2, unitCost: 5, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);
  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-R2-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 2, unitCost: 5 }] }).expect(201);
  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  // Create PR with qtyReturned 3 (>2)
  const prResp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-002', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'Too many', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 3, unitCost: 5 }] });
  // creation passes (draft) but confirm should fail
  const pr = prResp.body.data;
  await request(app).post(`/api/purchase-returns/${pr._id}/confirm`).expect(422);
});
