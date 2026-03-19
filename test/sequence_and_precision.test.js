const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { nextSequence } = require('../services/sequenceService');
const Purchase = require('../models/Purchase');

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

test('sequenceService produces gap-free padded sequences', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const s1 = await nextSequence(companyId, 'test_seq');
  const s2 = await nextSequence(companyId, 'test_seq');
  const s3 = await nextSequence(companyId, 'test_seq');

  expect(s1).toBe('00001');
  expect(s2).toBe('00002');
  expect(s3).toBe('00003');
});

test('Purchase toJSON serializes Decimal128 precision correctly', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const p = await Purchase.create({ company: companyId, supplier: new mongoose.Types.ObjectId(), items: [{ product: new mongoose.Types.ObjectId(), quantity: 1.2345, unitCost: 12.345678 }], createdBy: new mongoose.Types.ObjectId() });

  const json = p.toJSON();
  // check formatted strings exist
  expect(json.items).toBeDefined();
  expect(json.items[0].quantity).toMatch(/\d+\.\d{4}/);
  expect(json.items[0].unitCost).toMatch(/\d+\.\d{6}/);
  expect(json.subtotal).toMatch(/\d+\.\d{2}/);
});
