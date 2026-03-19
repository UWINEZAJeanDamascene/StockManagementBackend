const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Company = require('../models/Company');
const JournalService = require('../services/journalService');
const JournalEntry = require('../models/JournalEntry');
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

test('JournalService.createInvoiceEntry uses AccountMapping resolution for accounts', async () => {
  const company = await Company.create({ name: 'MapCo', email: 'map@co.com' });
  const userId = new mongoose.Types.ObjectId();

  // Seed default mappings for the company
  const uri = mongoServer.getUri();
  await seedAccountMappings(uri);

  // Create a simple invoice payload
  const invoice = {
    _id: new mongoose.Types.ObjectId(),
    invoiceNumber: 'INV-1001',
    date: new Date(),
    total: 110,
    vatAmount: 10
  };

  const result = await JournalService.createInvoiceEntry(company._id, userId, invoice);
  expect(result).toBeDefined();

  const saved = await JournalEntry.findById(result._id).lean();
  expect(saved).toBeTruthy();
  // There should be three lines: AR debit, Sales credit, VAT credit
  expect(saved.lines.length).toBeGreaterThanOrEqual(2);

  // Validate mapped account codes (seed uses DEFAULT_ACCOUNTS)
  const arLine = saved.lines.find(l => l.debit && l.debit > 0);
  const salesLine = saved.lines.find(l => l.credit && l.credit > 0 && l.accountCode === DEFAULT_ACCOUNTS.salesRevenue);
  const vatLine = saved.lines.find(l => l.credit && l.credit > 0 && l.accountCode === DEFAULT_ACCOUNTS.vatPayable);

  expect(arLine).toBeDefined();
  expect(arLine.accountCode).toBe(DEFAULT_ACCOUNTS.accountsReceivable);
  expect(salesLine).toBeDefined();
  expect(vatLine).toBeDefined();
});
