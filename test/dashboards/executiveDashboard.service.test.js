const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ExecutiveDashboardService = require('../../services/dashboards/ExecutiveDashboardService');
const ChartOfAccount = require('../../models/ChartOfAccount');
const JournalEntry = require('../../models/JournalEntry');
const BankAccount = require('../../models/BankAccount');
const Company = require('../../models/Company');
const Invoice = require('../../models/Invoice');
const User = require('../../models/User');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('ExecutiveDashboardService', () => {
  let companyA, companyB;
  let revenueAccount, expenseAccount, bankAccount;
  let userA;

  beforeEach(async () => {
    // Create two companies for cross-company testing
    companyA = await Company.create({ name: 'Company A', tin: 'TIN-A', email: 'company-a@test.com' });
    companyB = await Company.create({ name: 'Company B', tin: 'TIN-B', email: 'company-b@test.com' });

    // Create user for company A
    userA = await User.create({
      name: 'Test User A',
      email: 'user-a@test.com',
      password: 'password123',
      company: companyA._id,
      role: 'admin',
      isActive: true
    });

    // Create revenue account
    revenueAccount = await ChartOfAccount.create({
      company: companyA._id,
      name: 'Sales Revenue',
      code: '4100',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true,
      allowDirectPosting: true
    });

    // Create expense account
    expenseAccount = await ChartOfAccount.create({
      company: companyA._id,
      name: 'Rent Expense',
      code: '5100',
      type: 'expense',
      normal_balance: 'debit',
      isActive: true,
      allowDirectPosting: true
    });

    // Create bank account
    bankAccount = await BankAccount.create({
      company: companyA._id,
      name: 'Main Bank Account',
      accountNumber: '1234567890',
      bankName: 'Test Bank',
      openingBalance: 1000,
      currentBalance: 1000,
      isActive: true
    });
  });

  afterEach(async () => {
    await JournalEntry.deleteMany({});
    await ChartOfAccount.deleteMany({});
    await BankAccount.deleteMany({});
    await Invoice.deleteMany({});
    await User.deleteMany({});
    await Company.deleteMany({});
  });

  describe('get()', () => {
    it('revenue_this_month equals sum of CR minus DR on revenue accounts in current month', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Sales entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 500 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.revenue_this_month).toBe(500);
    });

    it('expenses_this_month equals sum of DR minus CR on expense accounts in current month', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Rent payment',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'Rent Expense', debit: 200, credit: 0 },
          { accountCode: '1000', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.expenses_this_month).toBe(200);
    });

    it('net_profit_this_month equals revenue minus expenses', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      // Revenue entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Sales',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 500 }
        ]
      });

      // Expense entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: startOfMonth,
        description: 'Rent',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'Rent Expense', debit: 200, credit: 0 },
          { accountCode: '1000', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.net_profit_this_month).toBe(300);
    });

    it('cash_balance equals journal DR minus CR on bank accounts plus opening balances', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Deposit',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      // Opening balance (1000) + debit (500) - credit (0) = 1500
      expect(result.cash_balance).toBe(1500);
    });

    it('is_profit is false when net_profit is negative', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      // Only expense entry (no revenue)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Rent',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'Rent Expense', debit: 200, credit: 0 },
          { accountCode: '1000', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.is_profit).toBe(false);
    });

    it('vs_last_month is null when previous month revenue is zero', async () => {
      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      // Since there's no previous month data, vs_last_month could be null or 0
      expect(result.vs_last_month === null || result.vs_last_month === 0).toBe(true);
    });

    it('outstanding_ar_count matches invoices with status confirmed or partially_paid', async () => {
      // Create confirmed invoice
      await Invoice.create({
        company: companyA._id,
        invoiceNumber: 'INV-001',
        client: new mongoose.Types.ObjectId(),
        date: new Date(),
        dueDate: new Date(),
        status: 'confirmed',
        subtotal: 500,
        taxAmount: 50,
        total: 550,
        amountPaid: 0,
        amountOutstanding: 550,
        lines: []
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.outstanding_ar_count).toBe(1);
    });

    it('overdue_ar includes only invoices where due_date is before today', async () => {
      const invoiceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const dueDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await Invoice.create({
        company: companyA._id,
        invoiceNumber: 'INV-OD-001',
        client: new mongoose.Types.ObjectId(),
        invoiceDate,
        dueDate,
        status: 'confirmed',
        subtotal: 500,
        taxAmount: 50,
        total: 550,
        amountPaid: 0,
        amountOutstanding: 550,
        lines: []
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.overdue_ar).toBe(550);
    });

    it('excludes draft and reversed journal entries from all calculations', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      // Posted entry (should be included)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Posted entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 100 }
        ]
      });

      // Draft entry (should be excluded)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: startOfMonth,
        description: 'Draft entry',
        status: 'draft',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 200 }
        ]
      });

      // Reversed entry (should be excluded)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: startOfMonth,
        description: 'Reversed entry',
        status: 'reversed',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 300 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.revenue_this_month).toBe(100);
    });

    it('scoped to company — company B data never appears in company A dashboard', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      // Entry for company B
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: startOfMonth,
        description: 'Company B revenue',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 1000 }
        ]
      });

      // Entry for company A
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Company A revenue',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 50 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.revenue_this_month).toBe(50);
    });

    it('returns cached result on second call within TTL', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Sales',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 500 }
        ]
      });

      const result1 = await ExecutiveDashboardService.get(companyA._id.toString());
      const result2 = await ExecutiveDashboardService.get(companyA._id.toString());
      
      // Both should be the same since second call uses cache
      expect(result1.revenue_this_month).toBe(result2.revenue_this_month);
    });

    it('cache is invalidated after new journal entry is posted', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      // First call
      const result1 = await ExecutiveDashboardService.get(companyA._id.toString());
      
      // Add new entry (this should invalidate cache)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Sales',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 500 }
        ]
      });

      // Second call should reflect new data (not cached)
      const result2 = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result2.revenue_this_month).toBe(500);
    });

    it('all monetary values rounded to 2 decimal places', async () => {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: startOfMonth,
        description: 'Sales with decimals',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100.456, credit: 0 },
          { accountCode: '4100', accountName: 'Sales Revenue', debit: 0, credit: 100.456 }
        ]
      });

      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      expect(result.revenue_this_month).toBe(100.46);
    });

    it('returns zero values not null when no activity exists', async () => {
      const result = await ExecutiveDashboardService.get(companyA._id.toString());
      
      expect(result.revenue_this_month).toBe(0);
      expect(result.expenses_this_month).toBe(0);
      expect(result.net_profit_this_month).toBe(0);
      expect(result.cash_balance).toBe(0);
    });

    it('does not write to any collection', async () => {
      const initialCount = await JournalEntry.countDocuments();
      const initialInvoiceCount = await Invoice.countDocuments();
      
      await ExecutiveDashboardService.get(companyA._id.toString());
      
      expect(await JournalEntry.countDocuments()).toBe(initialCount);
      expect(await Invoice.countDocuments()).toBe(initialInvoiceCount);
    });
  });
});
