const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Company = require('../models/Company');
const AccountMappingService = require('../services/accountMappingService');
const { seedAccountMappings } = require('../scripts/seedAccountMappings');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');

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

test('AccountMappingService.resolve returns seeded mapping for company', async () => {
  const c = await Company.create({ name: 'ACME Co', email: 'acme@example.com' });

  // Seed mappings (seedAccountMappings will reuse the open mongoose connection)
  const uri = mongoServer.getUri();
  await seedAccountMappings(uri);

  const acct = await AccountMappingService.resolve(c._id, 'inventory', 'costOfGoodsSold');
  expect(acct).toBe(DEFAULT_ACCOUNTS.costOfGoodsSold);

  // Test fallback when key missing: use provided fallback
  const fb = await AccountMappingService.resolve(c._id, 'nonexistent', 'noKey', '9999');
  expect(fb).toBe('9999');
});
