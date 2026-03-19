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

test('WAC product avg_cost recalculates on GRN confirm', async () => {
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
  app.use((err, req, res, next) => { console.error(err && err.stack ? err.stack : err); res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'WACCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'WAC Supplier' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'WAC WH' });

  // Create WAC product with existing stock
  const prod = await Product.create({ company: companyId, name: 'WACItem', sku: 'W-2', category: cat._id, unit: 'pcs', currentStock: 10, averageCost: 10, costingMethod: 'weighted' });

  const poResp = await request(app)
    .post('/api/purchase-orders')
    .send({ referenceNo: 'PO-WAC-001', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 5, unitCost: 20, taxRate: 0 }] })
    .expect(201);

  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);

  const grnResp = await request(app)
    .post('/api/grn')
    .send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-WAC-001', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 5, unitCost: 20 }] })
    .expect(201);

  const grn = grnResp.body.data;
  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  const updated = await Product.findById(prod._id).lean();
  // previous value: 10 units @ 10 = 100; received: 5 @ 20 = 100 => new avg = (100+100)/(15)=13.333...
  expect(Math.abs(updated.averageCost - ((100 + 100) / 15))).toBeLessThan(0.0001);
});

test('Partially receiving a PO sets PO status to partially_received', async () => {
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

  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'PartCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Part Supplier' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Part WH' });
  const prod = await Product.create({ company: companyId, name: 'PartItem', sku: 'P-1', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 0 });

  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-PART-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 10, unitCost: 2, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);

  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-PART-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 4, unitCost: 2 }] }).expect(201);
  const grn = grnResp.body.data;

  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  const updatedPO = await PurchaseOrder.findById(po._id).lean();
  expect(updatedPO.lines[0].qtyReceived).toBe(4);
  expect(updatedPO.status).toBe('partially_received');
});

test('Fully receiving a PO sets PO status to fully_received', async () => {
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

  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'FullCat' });
  const supplier = await Supplier.create({ company: companyId, name: 'Full Supplier' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'Full WH' });
  const prod = await Product.create({ company: companyId, name: 'FullItem', sku: 'F-1', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 0 });

  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-FULL-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 5, unitCost: 3, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);

  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-FULL-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 5, unitCost: 3 }] }).expect(201);
  const grn = grnResp.body.data;

  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(200);

  const updatedPO = await PurchaseOrder.findById(po._id).lean();
  expect(updatedPO.lines[0].qtyReceived).toBe(5);
  expect(updatedPO.status).toBe('fully_received');
});

test('Confirming a GRN against draft PO returns 409', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());
  const PurchaseOrder = require('../../models/PurchaseOrder');
  const GoodsReceivedNote = require('../../models/GoodsReceivedNote');
  const grnController = require('../../controllers/grnController');

  app.post('/api/grn/:id/confirm', (req, res, next) => {
    req.user = { _id: userId, id: userId, company: { _id: companyId } };
    grnController.confirmGRN(req, res, next);
  });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const po = await PurchaseOrder.create({ company: companyId, referenceNo: 'PO-DRAFT-1', supplier: new mongoose.Types.ObjectId(), lines: [], status: 'draft' });
  const grn = await GoodsReceivedNote.create({ company: companyId, referenceNo: 'GRN-DRAFT-1', purchaseOrder: po._id, warehouse: new mongoose.Types.ObjectId(), lines: [] });

  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(409);
});

test('If JournalService.createEntry throws, GRN stays draft and stock unchanged', async () => {
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
  const JournalService = require('../../services/journalService');

  app.post('/api/purchase-orders', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.createPurchaseOrder(req, res, next); });
  app.post('/api/purchase-orders/:id/approve', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; purchaseOrderController.approvePurchaseOrder(req, res, next); });
  app.post('/api/grn', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.createGRN(req, res, next); });
  app.post('/api/grn/:id/confirm', (req, res, next) => { req.user = { _id: userId, id: userId, company: { _id: companyId } }; grnController.confirmGRN(req, res, next); });
  app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });

  const cat = await Category.create({ company: companyId, name: 'RB' });
  const supplier = await Supplier.create({ company: companyId, name: 'RB Supplier' });
  const warehouse = await Warehouse.create({ company: companyId, name: 'RB WH' });
  const prod = await Product.create({ company: companyId, name: 'RBItem', sku: 'RB-1', category: cat._id, unit: 'pcs', currentStock: 0, costingMethod: 'fifo', averageCost: 0 });

  const poResp = await request(app).post('/api/purchase-orders').send({ referenceNo: 'PO-RB-1', supplier: supplier._id, warehouse: warehouse._id, lines: [{ product: prod._id, qtyOrdered: 2, unitCost: 10, taxRate: 0 }] }).expect(201);
  const po = poResp.body.data;
  await request(app).post(`/api/purchase-orders/${po._id}/approve`).expect(200);

  const grnResp = await request(app).post('/api/grn').send({ purchaseOrderId: po._id, warehouse: warehouse._id, referenceNo: 'GRN-RB-1', lines: [{ purchaseOrderLine: po.lines[0]._id, product: prod._id, qtyReceived: 2, unitCost: 10 }] }).expect(201);
  const grn = grnResp.body.data;

  // Spy createEntry to throw
  const js = require('../../services/journalService');
  const spy = jest.spyOn(js, 'createEntry').mockImplementation(() => { throw new Error('Simulated JE failure'); });

  await request(app).post(`/api/grn/${grn._id}/confirm`).expect(500);

  // Ensure no batches created, product stock unchanged, GRN still draft
  const batches = await InventoryBatch.find({ company: companyId, product: prod._id });
  expect(batches.length).toBe(0);
  const reprod = await Product.findById(prod._id).lean();
  expect(reprod.currentStock).toBe(0);
  const regrn = await GoodsReceivedNote.findById(grn._id).lean();
  expect(regrn.status).toBe('draft');

  spy.mockRestore();
});
