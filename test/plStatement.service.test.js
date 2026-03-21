const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const PLStatementService = require('../services/plStatementService');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const Company = require('../models/Company');
const User = require('../models/User');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('PLStatementService', () => {
  let companyA, companyB;
  let userA;
  let revenueAccount, cogsAccount, expenseAccount, assetAccount;

  beforeEach(async () => {
    // Create company
    companyA = await Company.create({
      name: 'Test Company A',
      currency: 'USD',
      timezone: 'UTC',
      email: 'test@companya.com'
    });

    companyB = await Company.create({
      name: 'Test Company B',
      currency: 'USD',
      timezone: 'UTC',
      email: 'test@companyb.com'
    });

    // Create user
    userA = await User.create({
      name: 'Test User A',
      email: `test-a-${Date.now()}@example.com`,
      password: 'password123',
      company: companyA._id,
      role: 'admin'
    });

    // Create revenue account
    revenueAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '4100',
      name: 'Sales Revenue',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true
    });

    // Create COGS account
    cogsAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '5100',
      name: 'Cost of Goods Sold',
      type: 'expense',
      subtype: 'cogs',
      normal_balance: 'debit',
      isActive: true
    });

    // Create expense account
    expenseAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '6100',
      name: 'Operating Expenses',
      type: 'expense',
      subtype: 'operating',
      normal_balance: 'debit',
      isActive: true
    });

    // Create asset account (should be excluded from P&L)
    assetAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '1100',
      name: 'Cash',
      type: 'asset',
      normal_balance: 'debit',
      isActive: true
    });

    // Create accounts for company B
    await ChartOfAccount.create({
      company: companyB._id,
      code: '4100',
      name: 'Sales Revenue',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true
    });
  });

  afterEach(async () => {
    await JournalEntry.deleteMany({});
    await ChartOfAccount.deleteMany({});
    await User.deleteMany({});
    await Company.deleteMany({});
  });

  describe('generate()', () => {
    it('returns zero gross_profit and zero net_profit when no activity', async () => {
      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.gross_profit).toBe(0);
      expect(report.current.net_profit).toBe(0);
      expect(report.current.revenue.total).toBe(0);
      expect(report.current.expenses.total).toBe(0);
    });

    it('total_revenue = sum of all CR balances on revenue accounts in period', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 200 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.revenue.total).toBe(200);
    });

    it('total_cogs = sum of all DR balances on cogs sub_type accounts in period', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 100, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 100 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.cogs.total).toBe(100);
    });

    it('gross_profit = total_revenue - total_cogs', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 200, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.gross_profit).toBe(300); // 500 - 200
    });

    it('total_expenses = sum of all DR balances on non-cogs expense accounts', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 150, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 150 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.expenses.total).toBe(150);
    });

    it('net_profit = gross_profit - total_expenses', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 200, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-17'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 100, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 100 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // gross = 500 - 200 = 300
      // net = 300 - 100 = 200
      expect(report.current.net_profit).toBe(200);
    });

    it('gross_margin_pct = (gross_profit / total_revenue) × 100', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 200, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // gross = 300, revenue = 500, margin = 60%
      expect(report.current.gross_margin_pct).toBe(60);
    });

    it('net_margin_pct = (net_profit / total_revenue) × 100', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 200, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 200 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-17'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 100, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 100 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // net = 200, revenue = 500, margin = 40%
      expect(report.current.net_margin_pct).toBe(40);
    });

    it('is_profit is false when net_profit is negative', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Expense only',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 100, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 100 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.is_profit).toBe(false);
    });

    it('revenue accounts show CR - DR (normal balance credit)', async () => {
      // Entry with both debit and credit on revenue account
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale with return',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 150, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 50, credit: 200 } // Net CR 150
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // Revenue = CR - DR = 200 - 50 = 150
      expect(report.current.revenue.total).toBe(150);
    });

    it('expense accounts show DR - CR (normal balance debit)', async () => {
      // Entry with both debit and credit on expense account
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Expense with refund',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 200, credit: 50 }, // Net DR 150
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 150 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // Expense = DR - CR = 200 - 50 = 150
      expect(report.current.expenses.total).toBe(150);
    });

    it('excludes draft and reversed journal entries', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Posted',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'Draft',
        status: 'draft',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 200 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-17'),
        description: 'Reversed',
        status: 'reversed',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 300 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.revenue.total).toBe(100);
    });

    it('excludes asset liability and equity accounts entirely', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Asset entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 1000 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      // Asset account (1100) should not appear in P&L
      const assetLines = [
        ...report.current.revenue.lines,
        ...report.current.cogs.lines,
        ...report.current.expenses.lines
      ].filter(l => l.account_code === '1100');
      
      expect(assetLines).toHaveLength(0);
    });

    it('comparative period populated when comparative dates provided', async () => {
      // Current period entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Current period',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      // Comparative period entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2023-06-15'),
        description: 'Comparative period',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        {
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
          comparativeDateFrom: '2023-01-01',
          comparativeDateTo: '2023-12-31'
        }
      );

      expect(report.current.revenue.total).toBe(100);
      expect(report.comparative).not.toBeNull();
      expect(report.comparative.revenue.total).toBe(50);
    });

    it('comparative period is null when no comparative dates provided', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Current period',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.comparative).toBeNull();
    });

    it('cogs lines separated from opex lines using sub_type field', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'COGS',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 100, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 50, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 50 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.cogs.lines).toHaveLength(1);
      expect(report.current.cogs.lines[0].account_code).toBe('5100');
      expect(report.current.expenses.lines).toHaveLength(1);
      expect(report.current.expenses.lines[0].account_code).toBe('6100');
    });

    it('scoped to company — company B revenue not included', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-A-001',
        date: new Date('2024-06-15'),
        description: 'Company A',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2024-06-15'),
        description: 'Company B',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 1000 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.revenue.total).toBe(100);
    });

    it('all amounts rounded to 2 decimal places', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100.456, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100.456 }
        ]
      });

      const report = await PLStatementService.generate(
        companyA._id.toString(),
        { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
      );

      expect(report.current.revenue.total).toBe(100.46);
      expect(report.current.gross_profit).toBe(100.46);
    });

    it('throws COMPANY_ID_REQUIRED when companyId is missing', async () => {
      await expect(
        PLStatementService.generate(null, { dateFrom: '2024-01-01', dateTo: '2024-12-31' })
      ).rejects.toThrow('COMPANY_ID_REQUIRED');
    });

    it('throws DATE_RANGE_REQUIRED when dateFrom is missing', async () => {
      await expect(
        PLStatementService.generate(companyA._id.toString(), { dateTo: '2024-12-31' })
      ).rejects.toThrow('DATE_RANGE_REQUIRED');
    });
  });
});
