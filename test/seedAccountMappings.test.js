const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Company = require('../models/Company');
const AccountMapping = require('../models/AccountMapping');
const { seedAccountMappings } = require('../scripts/seedAccountMappings');

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

test('seedAccountMappings creates mappings for companies', async () => {
  const c1 = await Company.create({ name: 'C1', email: 'c1@example.com' });
  const c2 = await Company.create({ name: 'C2', email: 'c2@example.com' });

  const uri = mongoServer.getUri();
  const result = await seedAccountMappings(uri);
  expect(result.upserted).toBeGreaterThan(0);

  const mappings = await AccountMapping.find({}).lean();
  // Expect at least mappings created for both companies
  expect(mappings.length).toBeGreaterThanOrEqual(6);
  const forC1 = mappings.filter(m => String(m.company) === String(c1._id));
  expect(forC1.length).toBeGreaterThan(0);
});
