const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AccountBalance = require('../../models/AccountBalance');
const AccountMapping = require('../../models/AccountMapping');
const mappingController = require('../../controllers/accountMappingController');
const glCtrl = require('../../controllers/glFinancialsController');
const Company = require('../../models/Company');
const User = require('../../models/User');

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

test('POST multi-code mapping then GL endpoints aggregate correctly', async () => {
  const company = await Company.create({ name: 'TestCo', email: 'testco@example.com', approvalStatus: 'approved', isActive: true });
  const user = await User.create({ name: 'Admin', email: 'admin@testco.com', password: 'secret123', company: company._id, role: 'admin', isActive: true });

  // Seed balances for two revenue accounts
  await AccountBalance.create({ company: company._id, accountCode: '4000', debit: 1000, credit: 0 });
  await AccountBalance.create({ company: company._id, accountCode: '4100', debit: 200, credit: 0 });

  // Create mapping via controller (simulate request)
  const req = { user: { company: { _id: company._id }, _id: user._id }, body: { module: 'report', key: 'salesRevenue', accountCode: ['4000', '4100'], description: 'Multi revenue mapping' } };
  let createResp = null;
  const resCreate = { status: (code) => ({ json: (obj) => { createResp = { code, obj }; } }), json: (obj) => { createResp = { code: 200, obj }; } };
  await mappingController.createMapping(req, resCreate);

  // Ensure salesReturns mapping does not default to DEFAULT_ACCOUNTS by upserting an empty mapping
  const reqReturns = { user: { company: { _id: company._id }, _id: user._id }, body: { module: 'report', key: 'salesReturns', accountCode: [], description: 'No returns for test' } };
  const resReturns = { status: (code) => ({ json: (obj) => {} }), json: (obj) => {} };
  await mappingController.createMapping(reqReturns, resReturns);

  // Verify mapping exists
  const m = await AccountMapping.findOne({ company: company._id, module: 'report', key: 'salesRevenue' }).lean();
  expect(m).toBeTruthy();
  expect(Array.isArray(m.accountCode)).toBe(true);
  expect(m.accountCode).toContain('4000');
  expect(m.accountCode).toContain('4100');

  const accountMappingService = require('../../services/accountMappingService');
  const resolved = await accountMappingService.resolve(company._id, 'report', 'salesRevenue');

  // Call P&L controller and assert aggregated sales = 1200
  const reqPl = { user: { company: { _id: company._id } }, query: {} };
  let plOutput = null;
  const resPl = { json: (obj) => { plOutput = obj; } };
  await glCtrl.getProfitAndLoss(reqPl, resPl, () => {});
  
  expect(plOutput).toBeDefined();
  expect(plOutput.success).toBe(true);
  expect(plOutput.data.sales).toBeCloseTo(1200, 2);
});
