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

test('getJournalTotals returns healthy true for balanced posted entries', async () => {
  const service = require('../../services/accountingHealthService');
  const JournalEntry = require('../../models/JournalEntry');
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  await JournalEntry.create({ company: companyId, entryNumber: 'JE-U1', date: new Date(), description: 't', lines: [ { accountCode: '1', accountName: 'a', debit: 10, credit: 0 }, { accountCode: '2', accountName: 'b', debit: 0, credit: 10 } ], status: 'posted', createdBy: userId });

  const res = await service.getJournalTotals(companyId);
  expect(res.healthy).toBe(true);
  expect(res.totals.count).toBe(1);
});

test('getStockDiscrepancies detects mismatches', async () => {
  const service = require('../../services/accountingHealthService');
  const Product = require('../../models/Product');
  const InventoryBatch = require('../../models/InventoryBatch');
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const prod = await Product.create({ company: companyId, name: 'X', sku: 'X-1', category: new mongoose.Types.ObjectId(), unit: 'pcs', currentStock: 5 });
  await InventoryBatch.create({ company: companyId, product: prod._id, warehouse: new mongoose.Types.ObjectId(), quantity: 2, availableQuantity: 2, createdBy: userId });

  const res = await service.getStockDiscrepancies(companyId);
  expect(res.healthy).toBe(false);
  expect(res.discrepancies.length).toBeGreaterThanOrEqual(1);
});
