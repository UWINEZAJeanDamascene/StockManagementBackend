const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');

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

test('Product monetary fields stored as Decimal128 and toJSON emits string with 2 decimals', async () => {
  const p = new Product({
    company: new mongoose.Types.ObjectId(),
    name: 'Test Product DEC',
    sku: 'TP-DEC-1',
    category: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    averageCost: 7.5,
    sellingPrice: 12.3456
  });

  await p.save();

  const doc = await Product.findById(p._id);
  const json = doc.toJSON();

  expect(typeof json.averageCost).toBe('string');
  expect(json.averageCost).toBe('7.50');

  expect(typeof json.sellingPrice).toBe('string');
  expect(json.sellingPrice).toBe('12.35');

  // Underlying Decimal128 stored value should stringify to the numeric string
  expect(doc.averageCost && doc.averageCost.toString()).toBe('7.5');
});
