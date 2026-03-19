const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const InventoryLayer = require('../models/InventoryLayer');
const Product = require('../models/Product');
const inventoryService = require('../services/inventoryService');

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

test('FIFO consumption allocates correctly across layers', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();

  // create two layers: 10 @5, then 20 @6
  await InventoryLayer.create({ company: companyId, product: productId, qtyReceived: 10, qtyRemaining: 10, unitCost: 5, receiptDate: new Date('2020-01-01') });
  await InventoryLayer.create({ company: companyId, product: productId, qtyReceived: 20, qtyRemaining: 20, unitCost: 6, receiptDate: new Date('2020-02-01') });

  const result = await inventoryService.consume(companyId, productId, 15, { method: 'fifo' });
  expect(result.allocations.length).toBe(2);
  expect(result.allocations[0].qty).toBe(10);
  expect(result.allocations[0].unitCost).toBe(5);
  expect(result.allocations[1].qty).toBe(5);
  expect(result.allocations[1].unitCost).toBe(6);
  expect(result.totalCost).toBeCloseTo(10 * 5 + 5 * 6);

  const layers = await InventoryLayer.find({ company: companyId, product: productId }).lean();
  const l1 = layers.find(l => l.unitCost === 5);
  const l2 = layers.find(l => l.unitCost === 6);
  expect(l1.qtyRemaining).toBe(0);
  expect(l2.qtyRemaining).toBe(15);
});

test('Weighted average uses product.averageCost for cost', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();

  await Product.create({ _id: productId, company: companyId, name: 'Test', averageCost: 7, currentStock: 100, sku: 'T100', category: new mongoose.Types.ObjectId() });

  const result = await inventoryService.consume(companyId, productId, 5, { method: 'weighted' });
  expect(result.allocations.length).toBe(1);
  expect(result.allocations[0].unitCost).toBe(7);
  expect(result.totalCost).toBeCloseTo(35);
});
