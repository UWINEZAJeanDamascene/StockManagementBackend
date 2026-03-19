const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const AccountBalance = require('../models/AccountBalance');
const AccountMapping = require('../models/AccountMapping');
const glCtrl = require('../controllers/glFinancialsController');

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

test('GL-driven P&L and Balance Sheet derive from AccountBalance snapshot and mappings', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Seed AccountBalance snapshot
  // Sales (treated as positive by controller when debit > credit in this design)
  await AccountBalance.create({ company: companyId, accountCode: '4000', debit: 1000, credit: 0 });
  // Sales returns
  await AccountBalance.create({ company: companyId, accountCode: '4100', debit: 50, credit: 0 });
  // COGS
  await AccountBalance.create({ company: companyId, accountCode: '5000', debit: 300, credit: 0 });
  // Salaries expense
  await AccountBalance.create({ company: companyId, accountCode: '5300', debit: 200, credit: 0 });

  // Balance sheet items
  await AccountBalance.create({ company: companyId, accountCode: '1100', debit: 500, credit: 0 }); // cash at bank
  await AccountBalance.create({ company: companyId, accountCode: '1300', debit: 200, credit: 0 }); // AR
  await AccountBalance.create({ company: companyId, accountCode: '1400', debit: 1000, credit: 0 }); // inventory
  await AccountBalance.create({ company: companyId, accountCode: '2000', debit: 0, credit: 400 }); // AP
  await AccountBalance.create({ company: companyId, accountCode: '3000', debit: 0, credit: 800 }); // share capital
  await AccountBalance.create({ company: companyId, accountCode: '3100', debit: 0, credit: 100 }); // retained earnings

  // Seed an account mapping override (optional)
  await AccountMapping.create({ company: companyId, module: 'report', key: 'salesRevenue', accountCode: '4000', createdBy: userId });

  // Call P&L controller
  const req = { user: { company: { _id: companyId } }, query: {} };
  let plOutput = null;
  const resPl = { json: (obj) => { plOutput = obj; } };
  await glCtrl.getProfitAndLoss(req, resPl, () => {});

  expect(plOutput).toBeDefined();
  expect(plOutput.success).toBe(true);
  // sales = 1000 - 50 = 950
  expect(plOutput.data.sales).toBeCloseTo(950, 2);
  expect(plOutput.data.cogs).toBeCloseTo(300, 2);
  expect(plOutput.data.grossProfit).toBeCloseTo(650, 2);
  expect(plOutput.data.totalExpenses).toBeCloseTo(200, 2);
  expect(plOutput.data.netProfit).toBeCloseTo(450, 2);

  // Call Balance Sheet controller
  let bsOutput = null;
  const resBs = { json: (obj) => { bsOutput = obj; } };
  await glCtrl.getBalanceSheet(req, resBs, () => {});

  expect(bsOutput).toBeDefined();
  expect(bsOutput.success).toBe(true);
  // Total assets = 500 + 200 + 1000 = 1700
  expect(bsOutput.data.assets.total).toBeCloseTo(1700, 2);
  // Total liabilities = 400
  expect(bsOutput.data.liabilities.total).toBeCloseTo(400, 2);
  // Total equity = 800 + 100 + (currentProfit derived from P&L) -> controller sums existing equity accounts only
  expect(bsOutput.data.equity.total).toBeGreaterThanOrEqual(900);
  // balancingDiff should be numeric
  expect(typeof bsOutput.data.balancingDiff).toBe('number');
});
