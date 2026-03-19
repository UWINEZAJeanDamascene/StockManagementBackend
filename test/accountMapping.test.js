const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const AccountMapping = require('../models/AccountMapping');
const Company = require('../models/Company');
const accountMappingController = require('../controllers/accountMappingController');

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

function mockRes() {
  const res = {};
  res.status = (code) => { res._status = code; return res; };
  res.json = (payload) => { res._json = payload; return res; };
  return res;
}

test('createMapping upserts and listMappings returns created mapping', async () => {
  const company = await Company.create({ name: 'TestCo', email: 'test@co.com' });
  const userId = new mongoose.Types.ObjectId();

  const req = { user: { company: company, _id: userId }, body: { module: 'sales', key: 'accountsReceivable', accountCode: '1300', description: 'AR mapping' } };
  const res = mockRes();

  await accountMappingController.createMapping(req, res);
  expect(res._status).toBe(201);
  expect(res._json.success).toBe(true);
  expect(res._json.data.accountCode).toBe('1300');

  // list
  const listReq = { user: { company: company, _id: userId } };
  const listRes = mockRes();
  await accountMappingController.listMappings(listReq, listRes);
  expect(listRes._json.success).toBe(true);
  expect(Array.isArray(listRes._json.data)).toBe(true);
  expect(listRes._json.data.length).toBe(1);
});

test('getMapping returns 404 for missing mapping', async () => {
  const company = await Company.create({ name: 'Test2', email: 't2@co.com' });
  const req = { user: { company: company, _id: new mongoose.Types.ObjectId() }, params: { id: new mongoose.Types.ObjectId() } };
  const res = mockRes();
  await accountMappingController.getMapping(req, res);
  expect(res._status).toBe(404);
});
