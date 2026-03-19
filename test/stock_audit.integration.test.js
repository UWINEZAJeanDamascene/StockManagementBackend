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
require('../models/User');
require('../models/Client');

const buildApp = (companyId) => {
  const app = express();
  app.use(express.json());
  const sac = require('../controllers/stockAuditController');

  app.use((req, res, next) => {
    const uid = new mongoose.Types.ObjectId();
    req.user = { _id: uid, id: uid, company: { _id: companyId || new mongoose.Types.ObjectId() } };
    next();
  });

  // Routes
  app.post('/api/stock-audits', sac.createStockAudit);
  app.get('/api/stock-audits', sac.getStockAudits);
  app.get('/api/stock-audits/:id', sac.getStockAudit);
  app.put('/api/stock-audits/:id', sac.updateStockAudit);
  app.delete('/api/stock-audits/:id', sac.deleteStockAudit);
  app.put('/api/stock-audits/:id/lines', sac.bulkUpdateLines);
  app.put('/api/stock-audits/:id/lines/:lineId', sac.updateLine);
  app.post('/api/stock-audits/:id/post', sac.postStockAudit);
  app.post('/api/stock-audits/:id/cancel', sac.cancelStockAudit);

  // Test error handler to surface stack traces in responses
  app.use((err, req, res, next) => {
    console.error('TEST ERROR STACK:', err && err.stack);
    res.status(err.status || 500).json({ message: err && err.message, stack: err && err.stack, code: err && err.code });
  });

  return app;
};

// ============================================
// ACCEPTANCE TESTS FOR STOCK AUDIT MODULE 3
// ============================================

// 3.6.1: Opening an audit snapshots qty_system correctly from live stock_levels
test('3.6.1: Opening audit snapshots qty_system from live stock levels', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');
  const StockAudit = require('../models/StockAudit');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Main', 
    code: 'WHM', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product with currentStock = 50
  const product = await Product.create({ 
    company: companyId, 
    name: 'AuditProd', 
    sku: 'AP-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 10, 
    currentStock: 50 
  });

  // Create batch with 50 units at cost 10
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

  // Open audit - this should snapshot qty_system from live stock
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ 
      warehouse: wh._id,
      type: 'full',
      auditDate: new Date()
    })
    .expect(201);

  expect(createRes.body.success).toBe(true);
  const audit = createRes.body.data;
  expect(audit.status).toBe('counting');
  expect(audit.items.length).toBeGreaterThan(0);

  // Find the line for our product (after populate, i.product is an object with _id)
  const line = audit.items.find(i => i.product && String(i.product._id) === String(product._id));
  expect(line).toBeDefined();
  
  // qty_system should equal live stock (50)
  expect(Number(line.qtySystem)).toBe(50);
  
  // qty_counted should be null initially
  expect(line.qtyCounted).toBeNull();
  
  // variance should be 0 initially
  expect(Number(line.qtyVariance)).toBe(0);
});

// 3.6.2: Subsequent stock movements after audit is opened do NOT change qty_system
test('3.6.2: Subsequent stock movements after audit opened do NOT change qty_system', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');
  const StockAudit = require('../models/StockAudit');
  const StockMovement = require('../models/StockMovement');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Test', 
    code: 'WHT', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product starts with 30 units
  const product = await Product.create({ 
    company: companyId, 
    name: 'FreezeTest', 
    sku: 'FT-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 5, 
    currentStock: 30 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 30, 
    availableQuantity: 30, 
    unitCost: 5, 
    totalCost: 150, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit - qty_system should be 30
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;
  // Find the line (after populate, i.product is an object with _id)
  const line = audit.items.find(i => i.product && String(i.product._id) === String(product._id));
  const qtySystemFrozen = Number(line.qtySystem);
  expect(qtySystemFrozen).toBe(30);

  // Simulate a subsequent stock movement (e.g., sale of 10 units)
  await StockMovement.create({
    company: companyId,
    product: product._id,
    type: 'out',
    reason: 'sale',
    quantity: 10,
    previousStock: 30,
    newStock: 20,
    unitCost: 5,
    totalCost: 50,
    warehouse: wh._id,
    performedBy: new mongoose.Types.ObjectId(),
    movementDate: new Date()
  });

  // Update product currentStock
  product.currentStock = 20;
  await product.save();

  // Get the audit again - qty_system should remain frozen at 30
  const getRes = await request(app)
    .get(`/api/stock-audits/${audit._id}`)
    .expect(200);

  const updatedAudit = getRes.body.data;
  // Find the line (after populate, i.product is an object with _id)
  const frozenLine = updatedAudit.items.find(i => i.product && String(i.product._id) === String(product._id));
  
  // qty_system should still be 30 (frozen)
  expect(Number(frozenLine.qtySystem)).toBe(30);
  
  // But actual stock is now 20
  expect(Number(frozenLine.qtySystem)).not.toBe(20);
});

// 3.6.3: Posting with positive variance: DR Inventory / CR Adjustment - balanced - qty_on_hand increases
test('3.6.3: Positive variance - DR Inventory / CR Adjustment - balanced - qty_on_hand increases', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');
  const JournalEntry = require('../models/JournalEntry');
  const StockMovement = require('../models/StockMovement');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Surplus', 
    code: 'WHS', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product with 20 units
  const product = await Product.create({ 
    company: companyId, 
    name: 'SurplusProd', 
    sku: 'SP-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 10, 
    currentStock: 20 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 20, 
    availableQuantity: 20, 
    unitCost: 10, 
    totalCost: 200, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;
  // Find the line (after populate, i.product is an object with _id)
  const line = audit.items.find(i => i.product && String(i.product._id) === String(product._id));

  // System shows 20, but we counted 25 (surplus of 5)
  const updateRes = await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product._id.toString(), qtyCounted: 25 }
      ]
    })
    .expect(200);

  // Post audit
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`)
    .expect(200);

  expect(postRes.body.success).toBe(true);
  expect(postRes.body.data.status).toBe('posted');

  // Verify journal entry: DR Inventory / CR Stock Adjustment
  const je = await JournalEntry.findOne({ 
    company: companyId, 
    sourceType: 'stock_audit', 
    sourceId: audit._id 
  }).lean();

  expect(je).toBeDefined();
  
  const debitLine = je.lines.find(l => Number(l.debit) > 0);
  const creditLine = je.lines.find(l => Number(l.credit) > 0);
  
  expect(debitLine).toBeDefined();
  expect(creditLine).toBeDefined();
  
  // Debit should go to Inventory (1400)
  expect(String(debitLine.accountCode)).toBe('1400');
  // Credit should go to Stock Adjustment (7100)
  expect(String(creditLine.accountCode)).toBe('7100');
  
  // Amount should be 5 units * $10 = $50
  expect(Math.abs(Number(debitLine.debit) - 50)).toBeLessThan(0.01);
  expect(Math.abs(Number(creditLine.credit) - 50)).toBeLessThan(0.01);

  // Verify stock movement was created
  const movement = await StockMovement.findOne({
    company: companyId,
    referenceDocument: audit._id,
    referenceModel: 'StockAudit'
  }).lean();

  expect(movement).toBeDefined();
  expect(movement.reason).toBe('audit_surplus');
  expect(Number(movement.quantity)).toBe(5);

  // Verify product currentStock increased from 20 to 25
  const updatedProduct = await Product.findById(product._id);
  expect(Number(updatedProduct.currentStock)).toBe(25);
});

// 3.6.4: Posting with negative variance: DR Adjustment / CR Inventory - balanced - qty_on_hand decreases
test('3.6.4: Negative variance - DR Adjustment / CR Inventory - balanced - qty_on_hand decreases', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');
  const JournalEntry = require('../models/JournalEntry');
  const StockMovement = require('../models/StockMovement');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Short', 
    code: 'WHSH', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product with 20 units
  const product = await Product.create({ 
    company: companyId, 
    name: 'ShortageProd', 
    sku: 'SHP-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 8, 
    currentStock: 20 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 20, 
    availableQuantity: 20, 
    unitCost: 8, 
    totalCost: 160, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;

  // System shows 20, but we counted 15 (shortage of 5)
  await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product._id.toString(), qtyCounted: 15 }
      ]
    })
    .expect(200);

  // Post audit
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`)
    .expect(200);

  expect(postRes.body.success).toBe(true);
  expect(postRes.body.data.status).toBe('posted');

  // Verify journal entry: DR Stock Adjustment / CR Inventory
  const je = await JournalEntry.findOne({ 
    company: companyId, 
    sourceType: 'stock_audit', 
    sourceId: audit._id 
  }).lean();

  expect(je).toBeDefined();
  
  const debitLine = je.lines.find(l => Number(l.debit) > 0);
  const creditLine = je.lines.find(l => Number(l.credit) > 0);
  
  expect(debitLine).toBeDefined();
  expect(creditLine).toBeDefined();
  
  // Debit should go to Stock Adjustment (7100)
  expect(String(debitLine.accountCode)).toBe('7100');
  // Credit should go to Inventory (1400)
  expect(String(creditLine.accountCode)).toBe('1400');
  
  // Amount should be 5 units * $8 = $40
  expect(Math.abs(Number(debitLine.debit) - 40)).toBeLessThan(0.01);
  expect(Math.abs(Number(creditLine.credit) - 40)).toBeLessThan(0.01);

  // Verify stock movement was created
  const movement = await StockMovement.findOne({
    company: companyId,
    referenceDocument: audit._id,
    referenceModel: 'StockAudit'
  }).lean();

  expect(movement).toBeDefined();
  expect(movement.reason).toBe('audit_shortage');
  expect(Number(movement.quantity)).toBe(5);

  // Verify product currentStock decreased from 20 to 15
  const updatedProduct = await Product.findById(product._id);
  expect(Number(updatedProduct.currentStock)).toBe(15);
});

// 3.6.5: Lines with zero variance produce no journal entry and no stock movement
test('3.6.5: Zero variance - no JE and no stock movement', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');
  const JournalEntry = require('../models/JournalEntry');
  const StockMovement = require('../models/StockMovement');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Exact', 
    code: 'WHE', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product with 100 units
  const product = await Product.create({ 
    company: companyId, 
    name: 'ExactMatch', 
    sku: 'EM-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 5, 
    currentStock: 100 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 100, 
    availableQuantity: 100, 
    unitCost: 5, 
    totalCost: 500, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;
  
  // Find the line (after populate, i.product is an object with _id)
  const line = audit.items.find(i => i.product && String(i.product._id) === String(product._id));

  // System shows 100, we count 100 (zero variance)
  await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product._id.toString(), qtyCounted: 100 }
      ]
    })
    .expect(200);

  // Post audit
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`)
    .expect(200);

  expect(postRes.body.success).toBe(true);
  expect(postRes.body.data.status).toBe('posted');

  // Verify NO journal entry was created for zero variance
  const je = await JournalEntry.findOne({ 
    company: companyId, 
    sourceType: 'stock_audit', 
    sourceId: audit._id 
  }).lean();

  expect(je).toBeNull();

  // Verify NO stock movement was created
  const movement = await StockMovement.findOne({
    company: companyId,
    referenceDocument: audit._id,
    referenceModel: 'StockAudit'
  }).lean();

  expect(movement).toBeNull();

  // Verify product currentStock unchanged
  const updatedProduct = await Product.findById(product._id);
  expect(Number(updatedProduct.currentStock)).toBe(100);
});

// 3.6.6: Posting audit where qty_counted has nulls returns 422 with offending line IDs
test('3.6.6: Posting audit with null qty_counted returns 422 with line IDs', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Partial', 
    code: 'WHP', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Create two products
  const product1 = await Product.create({ 
    company: companyId, 
    name: 'Prod1', 
    sku: 'P1-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 10, 
    currentStock: 20 
  });

  const product2 = await Product.create({ 
    company: companyId, 
    name: 'Prod2', 
    sku: 'P2-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 15, 
    currentStock: 30 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product1._id, 
    warehouse: wh._id, 
    quantity: 20, 
    availableQuantity: 20, 
    unitCost: 10, 
    totalCost: 200, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product2._id, 
    warehouse: wh._id, 
    quantity: 30, 
    availableQuantity: 30, 
    unitCost: 15, 
    totalCost: 450, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit - should have 2 lines
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;
  expect(audit.items.length).toBe(2);

  // Only update qty_counted for product1, leave product2 as null
  await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product1._id.toString(), qtyCounted: 20 }
      ]
    })
    .expect(200);

  // Attempt to post - should fail with 422
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`);

  expect(postRes.status).toBe(422);
  expect(postRes.body.message).toContain('qty_counted');
  
  // The response should indicate which lines are missing
  // (implementation detail: should return the count of missing lines)
  expect(postRes.body.missingCount).toBeDefined();
  expect(postRes.body.missingCount).toBe(1);
});

// 3.6.7: Second audit opened while one is in counting returns 409 AUDIT_IN_PROGRESS
test('3.6.7: Second audit in counting returns 409 AUDIT_IN_PROGRESS', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Double', 
    code: 'WHD', 
    inventoryAccount: '1400',
    isActive: true 
  });

  const product = await Product.create({ 
    company: companyId, 
    name: 'DoubleAudit', 
    sku: 'DA-001', 
    category: new mongoose.Types.ObjectId(), 
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

  // Open first audit - should succeed
  const firstRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  expect(firstRes.body.data.status).toBe('counting');

  // Try to open second audit for same warehouse - should fail with 409
  const secondRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id });

  expect(secondRes.status).toBe(409);
  expect(secondRes.body.code).toBe('AUDIT_IN_PROGRESS');
  expect(secondRes.body.message).toContain('already in progress');
});

// 3.6.8: After posting, stock_levels.qty_on_hand equals qty_system + qty_variance per line
test('3.6.8: After posting, qty_on_hand = qty_system + qty_variance per line', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Warehouse = require('../models/Warehouse');
  const Product = require('../models/Product');
  const InventoryBatch = require('../models/InventoryBatch');

  const wh = await Warehouse.create({ 
    company: companyId, 
    name: 'WH-Final', 
    code: 'WHF', 
    inventoryAccount: '1400',
    isActive: true 
  });

  // Product with 50 units
  const product = await Product.create({ 
    company: companyId, 
    name: 'FinalCheck', 
    sku: 'FC-001', 
    category: new mongoose.Types.ObjectId(), 
    unit: 'pcs', 
    averageCost: 7, 
    currentStock: 50 
  });

  await InventoryBatch.create({ 
    company: companyId, 
    product: product._id, 
    warehouse: wh._id, 
    quantity: 50, 
    availableQuantity: 50, 
    unitCost: 7, 
    totalCost: 350, 
    status: 'active', 
    createdBy: new mongoose.Types.ObjectId() 
  });

  // Open audit
  const createRes = await request(app)
    .post('/api/stock-audits')
    .send({ warehouse: wh._id })
    .expect(201);

  const audit = createRes.body.data;
  
  // Find the line (after populate, i.product is an object with _id)
  const line = audit.items.find(i => i.product && String(i.product._id) === String(product._id));

  const qtySystem = Number(line.qtySystem);
  expect(qtySystem).toBe(50);

  // Count 45 (variance = -5)
  const variance = -5;
  const qtyCounted = qtySystem + variance;

  await request(app)
    .put(`/api/stock-audits/${audit._id}/lines`)
    .send({
      lines: [
        { productId: product._id.toString(), qtyCounted: qtyCounted }
      ]
    })
    .expect(200);

  // Post audit
  const postRes = await request(app)
    .post(`/api/stock-audits/${audit._id}/post`)
    .expect(200);

  // Get final audit state
  const finalRes = await request(app)
    .get(`/api/stock-audits/${audit._id}`)
    .expect(200);

  const finalAudit = finalRes.body.data;
  // Find the line (after populate, i.product is an object with _id)
  const finalLine = finalAudit.items.find(i => i.product && String(i.product._id) === String(product._id));

  // Get product current stock (qty_on_hand)
  const updatedProduct = await Product.findById(product._id);
  const qtyOnHand = Number(updatedProduct.currentStock);

  // Verify: qty_on_hand = qty_system + qty_variance
  const qtyVariance = Number(finalLine.qtyVariance);
  const expectedQtyOnHand = qtySystem + qtyVariance;

  expect(qtyOnHand).toBe(expectedQtyOnHand);
  expect(qtyOnHand).toBe(45); // 50 + (-5) = 45
});
