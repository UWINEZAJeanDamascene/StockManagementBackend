const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const BalanceSheetService = require('../services/balanceSheetService');
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

describe('BalanceSheetService', () => {
  let companyA, companyB;
  let userA;
  let cashAccount, assetAccount, payableAccount, equityAccount, retainedEarningsAccount;

  beforeEach(async () => {
    // Create company
    companyA = await Company.create({
      name: 'Test Company A',
      currency: 'USD',
      timezone: 'UTC',
      email: 'test@companya.com',
      fiscal_year_start_month: 1
    });

    companyB = await Company.create({
      name: 'Test Company B',
      currency: 'USD',
      timezone: 'UTC',
      email: 'test@companyb.com',
      fiscal_year_start_month: 1
    });

    // Create user
    userA = await User.create({
      name: 'Test User A',
      email: `test-a-${Date.now()}@example.com`,
      password: 'password123',
      company: companyA._id,
      role: 'admin'
    });

    // Create asset accounts (type: asset)
    cashAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '1100',
      name: 'Cash at Bank',
      type: 'asset',
      subtype: 'cash',
      normal_balance: 'debit',
      isActive: true
    });

    assetAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '1500',
      name: 'Fixed Assets',
      type: 'asset',
      subtype: 'fixed_asset',
      normal_balance: 'debit',
      isActive: true
    });

    // Create accumulated depreciation (contra-asset)
    await ChartOfAccount.create({
      company: companyA._id,
      code: '1510',
      name: 'Accumulated Depreciation',
      type: 'asset',
      subtype: 'contra_asset',
      normal_balance: 'credit',
      isActive: true
    });

    // Create liability accounts
    payableAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '2100',
      name: 'Accounts Payable',
      type: 'liability',
      subtype: 'ap',
      normal_balance: 'credit',
      isActive: true
    });

    await ChartOfAccount.create({
      company: companyA._id,
      code: '2400',
      name: 'Long-term Loan',
      type: 'liability',
      subtype: 'loan',
      normal_balance: 'credit',
      isActive: true
    });

    // Create equity accounts
    equityAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '3100',
      name: 'Share Capital',
      type: 'equity',
      subtype: 'capital',
      normal_balance: 'credit',
      isActive: true
    });

    retainedEarningsAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '3200',
      name: 'Retained Earnings',
      type: 'equity',
      subtype: 'retained',
      normal_balance: 'credit',
      isActive: true
    });

    // Create revenue and expense accounts for P&L
    await ChartOfAccount.create({
      company: companyA._id,
      code: '4100',
      name: 'Sales Revenue',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true
    });

    const expenseAccount = await ChartOfAccount.create({
      company: companyA._id,
      code: '6100',
      name: 'Operating Expenses',
      type: 'expense',
      subtype: 'operating',
      normal_balance: 'debit',
      isActive: true
    });

    // Create accounts for company B
    await ChartOfAccount.create({
      company: companyB._id,
      code: '1100',
      name: 'Cash at Bank',
      type: 'asset',
      subtype: 'cash',
      normal_balance: 'debit',
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
    it('total_assets = total_liabilities + total_equity', async () => {
      // Create a balanced entry: Asset +100, Equity +100
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Owner investment',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      expect(report.assets.total).toBe(report.liabilities.total + report.equity.total);
    });

    it('is_balanced is true when equation holds within 0.01', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Balanced entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      expect(report.is_balanced).toBe(true);
    });

    it('balance sheet is cumulative — includes all activity from beginning to as_of_date', async () => {
      // Entry in 2023
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2023-06-15'),
        description: '2023 entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 500 }
        ]
      });

      // Entry in 2024
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-15'),
        description: '2024 entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 300 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      // Should include both entries (500 + 300 = 800)
      const cashLine = report.assets.current.lines.find(l => l.account_code === '1100');
      expect(cashLine.amount).toBe(800);
    });

    it('excludes journal entries after as_of_date', async () => {
      // Entry before as_of_date
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Before date',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      // Entry after as_of_date
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2025-06-15'),
        description: 'After date',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 500 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      // Should only include the 2024 entry
      const cashLine = report.assets.current.lines.find(l => l.account_code === '1100');
      expect(cashLine.amount).toBe(100);
    });

    it('accumulated depreciation shown as negative amount in current assets', async () => {
      // Fixed asset entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-01-01'),
        description: 'Asset purchase',
        status: 'posted',
        lines: [
          { accountCode: '1500', accountName: 'Fixed Assets', debit: 1000, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 1000 }
        ]
      });

      // Depreciation entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-15'),
        description: 'Depreciation',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 100, credit: 0 },
          { accountCode: '1510', accountName: 'Accum Depreciation', debit: 0, credit: 100 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const accumDepLine = report.assets.current.lines.find(l => l.account_code === '1510');
      expect(accumDepLine.amount).toBe(-100);
      expect(accumDepLine.sub_type).toBe('contra_asset');
    });

    it('retained earnings includes current period net profit', async () => {
      // Opening retained earnings
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-01-01'),
        description: 'Opening',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '3200', accountName: 'Retained Earnings', debit: 0, credit: 500 }
        ]
      });

      // Revenue (will generate net profit)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 200 }
        ]
      });

      // Expense
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-20'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 50, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 50 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const retainedEarningsLine = report.equity.lines.find(l => l.account_code === '3200');
      // Opening 500 + Net profit (200 - 50 = 150) = 650
      expect(retainedEarningsLine.amount).toBe(650);
      expect(retainedEarningsLine.includes_current_period_profit).toBe(true);
      expect(retainedEarningsLine.current_period_net_profit).toBe(150);
    });

    it('current_period_net_profit matches P&L net profit for fiscal year to date', async () => {
      // Revenue
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      // Expense
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-20'),
        description: 'Expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 30, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 30 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      // Net profit = 100 - 30 = 70
      expect(report.current_period_net_profit).toBe(70);
    });

    it('current assets include cash ar inventory prepaid and contra_asset sub_types', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const currentAssetCodes = report.assets.current.lines.map(l => l.sub_type);
      expect(currentAssetCodes).toContain('cash');
    });

    it('non-current assets include fixed_asset sub_type', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Fixed asset',
        status: 'posted',
        lines: [
          { accountCode: '1500', accountName: 'Fixed Assets', debit: 1000, credit: 0 },
          { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 1000 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const nonCurrentAssetCodes = report.assets.non_current.lines.map(l => l.sub_type);
      expect(nonCurrentAssetCodes).toContain('fixed_asset');
    });

    it('current liabilities include ap tax accrual sub_types', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'AP entry',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 100, credit: 0 },
          { accountCode: '2100', accountName: 'Accounts Payable', debit: 0, credit: 100 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const currentLiabCodes = report.liabilities.current.lines.map(l => l.sub_type);
      expect(currentLiabCodes).toContain('ap');
    });

    it('non-current liabilities include loan sub_type', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Loan',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '2400', accountName: 'Loan', debit: 0, credit: 1000 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const nonCurrentLiabCodes = report.liabilities.non_current.lines.map(l => l.sub_type);
      expect(nonCurrentLiabCodes).toContain('loan');
    });

    it('excludes draft and reversed journal entries', async () => {
      // Posted entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Posted',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      // Draft entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'Draft',
        status: 'draft',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 200 }
        ]
      });

      // Reversed entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-17'),
        description: 'Reversed',
        status: 'reversed',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 300 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const cashLine = report.assets.current.lines.find(l => l.account_code === '1100');
      expect(cashLine.amount).toBe(100);
    });

    it('scoped to company — company B accounts never appear', async () => {
      // Company A entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-A-001',
        date: new Date('2024-06-15'),
        description: 'Company A',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100 }
        ]
      });

      // Company B entry
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2024-06-15'),
        description: 'Company B',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 1000 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const cashLine = report.assets.current.lines.find(l => l.account_code === '1100');
      expect(cashLine.amount).toBe(100);
    });

    it('all amounts rounded to 2 decimal places', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Entry',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 100.456, credit: 0 },
          { accountCode: '3100', accountName: 'Share Capital', debit: 0, credit: 100.456 }
        ]
      });

      const report = await BalanceSheetService.generate(
        companyA._id.toString(),
        { asOfDate: '2024-12-31' }
      );

      const cashLine = report.assets.current.lines.find(l => l.account_code === '1100');
      expect(cashLine.amount).toBe(100.46);
      expect(report.assets.total).toBe(100.46);
    });

    it('throws COMPANY_ID_REQUIRED when companyId is missing', async () => {
      await expect(
        BalanceSheetService.generate(null, { asOfDate: '2024-12-31' })
      ).rejects.toThrow('COMPANY_ID_REQUIRED');
    });

    it('throws AS_OF_DATE_REQUIRED when asOfDate is missing', async () => {
      await expect(
        BalanceSheetService.generate(companyA._id.toString(), {})
      ).rejects.toThrow('AS_OF_DATE_REQUIRED');
    });
  });
});
