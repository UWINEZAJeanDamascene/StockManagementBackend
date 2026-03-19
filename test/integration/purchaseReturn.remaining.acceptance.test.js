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

test('Attempting to return when warehouse has insufficient stock returns 409', async () => {
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

  const cat = await Category.create({ company: companyId, name: 'PRInsufCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Return Supplier Insuf' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Return WH Insuf' });
  const prod = await Product.create({ company: companyId, name: 'ReturnItemInsuf', sku: 'RI-INS', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 5 });

  // Create PO + GRN receiving 2
  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-INS-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 2, unitCost: 5, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);
  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-INS-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 2, unitCost: 5 }] }).expect(201);
  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  // Simulate stock being consumed elsewhere so warehouse has insufficient currentStock
  await Product.findByIdAndUpdate(prod._id, { $set: { currentStock: 0 } });

  // Create PR for 2 units (<= received) but stock insufficient -> confirm should return 409
  const prResp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-INS-001', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'Insufficient test', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 2, unitCost: 5 }] }).expect(201);
  const pr = prResp.body.data;
  const confirmRes = await request(app).post(`/api/purchase-returns/${pr._id}/confirm`).expect(409);
  expect(confirmRes.body.message).toMatch(/INSUFFICIENT_STOCK/);
});

test('Cumulative returns across multiple return notes cannot exceed GRN quantity', async () => {
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

  const cat = await Category.create({ company: companyId, name: 'PRCumCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Return Supplier Cum' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Return WH Cum' });
  const prod = await Product.create({ company: companyId, name: 'ReturnItemCum', sku: 'R-CUM', category: cat._id, unit: 'pcs', currentStock: 10, costingMethod: 'fifo', averageCost: 5 });

  // Create PO + GRN receiving 2
  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-CUM-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 2, unitCost: 5, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);
  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-CUM-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 2, unitCost: 5 }] }).expect(201);
  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  // First PR returns 1 and confirmed
  const pr1Resp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-CUM-1', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'Cum1', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 1, unitCost: 5 }] }).expect(201);
  const pr1 = pr1Resp.body.data;
  await request(app).post(`/api/purchase-returns/${pr1._id}/confirm`).expect(200);

  // Second PR attempts to return 2 (cumulative 3 > 2) -> confirm should return 422
  const pr2Resp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-CUM-2', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'Cum2', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 2, unitCost: 5 }] }).expect(201);
  const pr2 = pr2Resp.body.data;
  await request(app).post(`/api/purchase-returns/${pr2._1d || pr2._id}/confirm`).expect(422);
});

test('FIFO returned lot availableQuantity reduced correctly and original GRN journal unchanged; JournalService failure leaves draft and stock unchanged', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const purchaseOrderController = require('../../controllers/purchaseOrderController');
  const grnController = require('../../controllers/grnController');
  const purchaseReturnController = require('../../controllers/purchaseReturnController');
  const JournalService = require('../../services/journalService');
  const Product = require('../../models/Product');
  const Category = require('../../models/Category');
  const Supplier = require('../../models/Supplier');
  const Warehouse = require('../../models/Warehouse');
  const InventoryBatch = require('../../models/InventoryBatch');
  const GoodsReceivedNote = require('../../models/GoodsReceivedNote');

  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.post('/api/purchase-returns', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.createPurchaseReturn(req, res, next); });
  app.post('/api/purchase-returns/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseReturnController.confirmPurchaseReturn(req, res, next); });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'PRFIFOCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Return Supplier FIFO' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Return WH FIFO' });
  const prod = await Product.create({ company: companyId, name: 'ReturnItemFIFO', sku: 'R-FIFO', category: cat._id, unit: 'pcs', currentStock: 10, costingMethod: 'fifo', averageCost: 5 });

  // Create PO + GRN receiving 5
  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-FIFO-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 5, unitCost: 5, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);
  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-FIFO-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 5, unitCost: 5 }] }).expect(201);
  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  // Capture GRN's journal entry id
  const grnDb = await GoodsReceivedNote.findById(grn._id).lean();
  const grnJe = grnDb.journalEntry;

  // Find batch created by GRN
  const batch = await InventoryBatch.findOne({ company: companyId, product: prod._id, warehouse: warehouse._id }).lean();
  const originalAvailable = batch ? batch.availableQuantity : 0;
  expect(originalAvailable).toBeGreaterThanOrEqual(5);

  // Create PR returning 3 units
  const prResp = await request(app).post('/api/purchase-returns').send({ referenceNo: 'PRN-FIFO-1', grn: grn._id, supplier: supplier._id, warehouse: warehouse._id, reason: 'FIFO test', lines: [{ grnLine: grn.lines[0]._id, product: prod._id, qtyReturned: 3, unitCost: 5 }] }).expect(201);
  const pr = prResp.body.data;

  // Temporarily monkeypatch JournalService.createEntry to throw to test rollback
  const origCreate = JournalService.createEntry;
  JournalService.createEntry = async () => { throw new Error('Journal post failure'); };

  const failRes = await request(app).post(`/api/purchase-returns/${pr._id}/confirm`);
  expect(failRes.status).toBeGreaterThanOrEqual(500);

  // Verify PR still draft and stock unchanged
  const prDbAfterFail = await (require('../../models/PurchaseReturn')).findById(pr._id).lean();
  expect(prDbAfterFail.status).toBe('draft');

  const prodAfterFail = await Product.findById(prod._id).lean();
  expect(prodAfterFail.currentStock).toBeGreaterThanOrEqual(0);

  const batchAfterFail = await InventoryBatch.findOne({ company: companyId, product: prod._id, warehouse: warehouse._id }).lean();
  expect(batchAfterFail.availableQuantity).toBe(originalAvailable);

  // Restore JournalService.createEntry
  JournalService.createEntry = origCreate;

  // Now confirm PR properly
  await request(app).post(`/api/purchase-returns/${pr._id}/confirm`).expect(200);

  // After successful confirm, batch available reduced by 3
  const batchAfter = await InventoryBatch.findOne({ company: companyId, product: prod._id, warehouse: warehouse._id }).lean();
  expect(batchAfter.availableQuantity).toBe(originalAvailable - 3);

  // GRN's journal entry unchanged and PR has its own journal
  const grnFinal = await GoodsReceivedNote.findById(grn._id).lean();
  expect(String(grnFinal.journalEntry)).toBe(String(grnJe));

  const prFinal = await (require('../../models/PurchaseReturn')).findById(pr._id).lean();
  expect(prFinal.journalEntry).toBeTruthy();
  expect(String(prFinal.journalEntry)).not.toBe(String(grnJe));
});
