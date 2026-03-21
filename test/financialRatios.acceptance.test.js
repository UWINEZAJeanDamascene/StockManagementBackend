const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const FinancialRatiosService = require('../services/financialRatiosService');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

let mongoServer;
let companyA, companyB;
let userA, userB;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  
  const Company = require('../models/Company');
  const User = require('../models/User');
  
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

  userA = await User.create({
    name: 'Test User A',
    email: `test-a-${Date.now()}@example.com`,
    password: 'password123',
    company: companyA._id,
    role: 'admin'
  });

  userB = await User.create({
    name: 'Test User B',
    email: `test-b-${Date.now()}@example.com`,
    password: 'password123',
    company: companyB._id,
    role: 'admin'
  });

  // Create chart of accounts for Company A - Assets
  await ChartOfAccount.create({
    company: companyA._id,
    code: '1100',
    name: 'Bank',
    type: 'asset',
    subtype: 'cash',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '1200',
    name: 'Accounts Receivable',
    type: 'asset',
    subtype: 'ar',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '1300',
    name: 'Inventory',
    type: 'asset',
    subtype: 'inventory',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '1500',
    name: 'Fixed Assets',
    type: 'asset',
    subtype: 'fixed',
    isActive: true,
    normal_balance: 'debit'
  });

  // Liabilities
  await ChartOfAccount.create({
    company: companyA._id,
    code: '2100',
    name: 'Accounts Payable',
    type: 'liability',
    subtype: 'ap',
    isActive: true,
    normal_balance: 'credit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '2200',
    name: 'Long-term Debt',
    type: 'liability',
    subtype: 'long_term_liability',
    isActive: true,
    normal_balance: 'credit'
  });

  // Equity
  await ChartOfAccount.create({
    company: companyA._id,
    code: '3100',
    name: 'Common Stock',
    type: 'equity',
    subtype: 'equity',
    isActive: true,
    normal_balance: 'credit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '3200',
    name: 'Retained Earnings',
    type: 'equity',
    subtype: 'equity',
    isActive: true,
    normal_balance: 'credit'
  });

  // Revenue
  await ChartOfAccount.create({
    company: companyA._id,
    code: '4100',
    name: 'Sales Revenue',
    type: 'revenue',
    subtype: 'operating',
    isActive: true,
    normal_balance: 'credit'
  });

  // Expenses
  await ChartOfAccount.create({
    company: companyA._id,
    code: '5100',
    name: 'Cost of Goods Sold',
    type: 'expense',
    subtype: 'cogs',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyA._id,
    code: '6100',
    name: 'Operating Expenses',
    type: 'expense',
    subtype: 'operating',
    isActive: true,
    normal_balance: 'debit'
  });

  // Create chart of accounts for Company B
  await ChartOfAccount.create({
    company: companyB._id,
    code: '1100',
    name: 'Bank',
    type: 'asset',
    subtype: 'cash',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyB._id,
    code: '1300',
    name: 'Inventory',
    type: 'asset',
    subtype: 'inventory',
    isActive: true,
    normal_balance: 'debit'
  });
  await ChartOfAccount.create({
    company: companyB._id,
    code: '2100',
    name: 'Accounts Payable',
    type: 'liability',
    subtype: 'ap',
    isActive: true,
    normal_balance: 'credit'
  });
  await ChartOfAccount.create({
    company: companyB._id,
    code: '4100',
    name: 'Sales Revenue',
    type: 'revenue',
    subtype: 'operating',
    isActive: true,
    normal_balance: 'credit'
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await JournalEntry.deleteMany({});
});

describe('FinancialRatiosService', () => {

  describe('compute()', () => {
    it('current_ratio = current_assets / current_liabilities', async () => {
      // Setup: Current Assets = 100000, Current Liabilities = 50000
      // Bank 50000 DR, AR 50000 DR, AP 50000 CR
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2025-06-30'),
        description: 'Setup current assets',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current Ratio = 100000 / 100000 = 1
      expect(report.ratios.current_ratio.value).toBe(1);
    });

    it('quick_ratio = (current_assets - inventory) / current_liabilities', async () => {
      // Setup: Current Assets = 100000 (including inventory 30000), Current Liabilities = 50000
      // Quick Assets = 100000 - 30000 = 70000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2025-06-30'),
        description: 'Setup with inventory',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 70000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 30000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Quick Ratio = (100000 - 30000) / 100000 = 70000 / 100000 = 0.7
      expect(report.ratios.quick_ratio.value).toBe(0.7);
    });

    it('gross_margin_pct = (gross_profit / revenue) × 100', async () => {
      // Revenue = 100000, COGS = 60000, Gross Profit = 40000
      // Gross Margin = 40000 / 100000 * 100 = 40%
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2025-06-15'),
        description: 'Sales with COGS',
        sourceType: 'invoice',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '4100', accountName: 'Revenue', debit: 0, credit: 100000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-004',
        date: new Date('2025-06-15'),
        description: 'COGS',
        sourceType: 'cogs',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 60000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 0, credit: 60000 }
        ],
        totalDebit: 60000,
        totalCredit: 60000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      expect(report.ratios.gross_margin_pct.value).toBe(40);
    });

    it('inventory_turnover = cogs / avg_inventory', async () => {
      // Setup opening inventory
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-005',
        date: new Date('2025-01-01'),
        description: 'Opening inventory',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Inventory', debit: 20000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 20000 }
        ],
        totalDebit: 20000,
        totalCredit: 20000,
        createdBy: userA._id
      });

      // COGS in period = 60000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-006',
        date: new Date('2025-06-15'),
        description: 'COGS',
        sourceType: 'cogs',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 60000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 0, credit: 60000 }
        ],
        totalDebit: 60000,
        totalCredit: 60000,
        createdBy: userA._id
      });

      // Ending inventory = 10000 (20000 + purchases - 60000 = negative, but let's assume purchases)
      // Actually, let's add purchases
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-007',
        date: new Date('2025-03-01'),
        description: 'Purchases',
        sourceType: 'purchase',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Inventory', debit: 50000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 50000 }
        ],
        totalDebit: 50000,
        totalCredit: 50000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Avg Inventory = (20000 + 10000) / 2 = 15000
      // Inventory Turnover = 60000 / 15000 = 4
      expect(report.ratios.inventory_turnover.value).toBe(4);
    });

    it('days_inventory = 365 / inventory_turnover', async () => {
      // Same setup as above, inventory turnover = 4
      // Days Inventory = 365 / 4 = 91.25
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-008',
        date: new Date('2025-01-01'),
        description: 'Opening inventory',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Inventory', debit: 20000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 20000 }
        ],
        totalDebit: 20000,
        totalCredit: 20000,
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-009',
        date: new Date('2025-06-15'),
        description: 'COGS',
        sourceType: 'cogs',
        status: 'posted',
        lines: [
          { accountCode: '5100', accountName: 'COGS', debit: 60000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 0, credit: 60000 }
        ],
        totalDebit: 60000,
        totalCredit: 60000,
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-010',
        date: new Date('2025-03-01'),
        description: 'Purchases',
        sourceType: 'purchase',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Inventory', debit: 50000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 50000 }
        ],
        totalDebit: 50000,
        totalCredit: 50000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      expect(report.ratios.days_inventory_outstanding.value).toBe(91.25);
    });

    it('ap_turnover = total_purchases / avg_ap', async () => {
      // Setup opening AP
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-011',
        date: new Date('2025-01-01'),
        description: 'Opening AP',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '3100', accountName: 'Equity', debit: 20000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 20000 }
        ],
        totalDebit: 20000,
        totalCredit: 20000,
        createdBy: userA._id
      });

      // Purchases in period
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-012',
        date: new Date('2025-03-01'),
        description: 'Purchases',
        sourceType: 'purchase',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Inventory', debit: 50000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 50000 }
        ],
        totalDebit: 50000,
        totalCredit: 50000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Total Purchases = 50000, Avg AP = (20000 + 70000) / 2 = 45000
      // AP Turnover = 50000 / 45000 = 1.11
      expect(report.ratios.ap_turnover.value).toBeCloseTo(1.11, 1);
    });

    it('return_on_assets = (net_profit / total_assets) × 100', async () => {
      // Setup: Total Assets = 100000, Net Profit = 10000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-013',
        date: new Date('2025-06-30'),
        description: 'Setup assets',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 100000 }
        ],
        createdBy: userA._id
      });

      // Revenue - Expenses = Net Profit (10000)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-014',
        date: new Date('2025-06-15'),
        description: 'Revenue',
        sourceType: 'invoice',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 50000, credit: 0 },
          { accountCode: '4100', accountName: 'Revenue', debit: 0, credit: 50000 }
        ],
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-015',
        date: new Date('2025-06-15'),
        description: 'Expenses',
        sourceType: 'expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 40000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 40000 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // ROA = net_profit / total_assets * 100
      // Assets = 110000 (100000 + 10000 net profit added to equity as retained earnings)
      // Net profit = 10000
      // ROA = 10000 / 110000 * 100 = 9.09%
      expect(report.ratios.return_on_assets.value).toBeCloseTo(9.09, 1);
    });

    it('debt_to_equity = total_liabilities / total_equity', async () => {
      // Setup: Total Liabilities = 40000, Total Equity = 60000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-016',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 40000 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 60000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Debt to Equity = 40000 / 60000 = 0.67
      expect(report.ratios.debt_to_equity.value).toBeCloseTo(0.67, 1);
    });

    it('net_profit_margin_pct = (net_profit / revenue) × 100', async () => {
      // Revenue = 100000, Net Profit = 15000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-017',
        date: new Date('2025-06-15'),
        description: 'Revenue',
        sourceType: 'invoice',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '4100', accountName: 'Revenue', debit: 0, credit: 100000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-018',
        date: new Date('2025-06-15'),
        description: 'Expenses',
        sourceType: 'expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expenses', debit: 85000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 85000 }
        ],
        totalDebit: 85000,
        totalCredit: 85000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Net Profit Margin = 15000 / 100000 * 100 = 15%
      expect(report.ratios.net_profit_margin_pct.value).toBe(15);
    });

    it('returns null for ratio when denominator is zero — no division by zero error', async () => {
      // No liabilities - division by zero for current ratio
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-019',
        date: new Date('2025-06-30'),
        description: 'No liabilities',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 100000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current ratio should be null (no liabilities)
      expect(report.ratios.current_ratio.value).toBeNull();
      // Quick ratio should also be null
      expect(report.ratios.quick_ratio.value).toBeNull();
    });

    it('current_ratio status is good when value >= 2', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-020',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 200000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 100000 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current Ratio = 200000 / 100000 = 2
      expect(report.ratios.current_ratio.status).toBe('good');
    });

    it('current_ratio status is warning when value between 1 and 2', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-021',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 150000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 50000 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current Ratio = 150000 / 100000 = 1.5
      expect(report.ratios.current_ratio.status).toBe('warning');
    });

    it('current_ratio status is danger when value < 1', async () => {
      // Scenario: Assets = 40000, Liabilities = 100000 (negative equity)
      // Current Ratio = 40000 / 100000 = 0.4 < 1 = danger
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-022',
        date: new Date('2025-06-30'),
        description: 'Setup - insolvent',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 40000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 },
          { accountCode: '3100', accountName: 'Equity', debit: 60000, credit: 0 }
        ],
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current Ratio = 40000 / 100000 = 0.4
      expect(report.ratios.current_ratio.status).toBe('danger');
    });

    it('quick_ratio status is good when value >= 1', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-023',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 50000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 50000 }
        ],
        totalDebit: 150000,
        totalCredit: 150000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Quick Ratio = (150000 - 50000) / 100000 = 1
      expect(report.ratios.quick_ratio.status).toBe('good');
    });

    it('quick_ratio status is danger when value < 0.5', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-024',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 30000, credit: 0 },
          { accountCode: '1300', accountName: 'Inventory', debit: 100000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 30000 }
        ],
        totalDebit: 130000,
        totalCredit: 130000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Quick Ratio = (130000 - 100000) / 100000 = 0.3
      expect(report.ratios.quick_ratio.status).toBe('danger');
    });

    it('all ratio values rounded to 2 decimal places', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-025',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 33333.33, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 133333.33 },
          { accountCode: '3100', accountName: 'Equity', debit: 0, credit: 0 }
        ],
        totalDebit: 133333.33,
        totalCredit: 133333.33,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Current Ratio = 133333.33 / 133333.33 = 1
      const value = report.ratios.current_ratio.value;
      expect(value.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });

    it('inputs object included on every ratio for audit trail', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-026',
        date: new Date('2025-06-30'),
        description: 'Setup',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      const report = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Check inputs are present
      expect(report.ratios.current_ratio.inputs).toBeDefined();
      expect(report.ratios.current_ratio.inputs.current_assets).toBeDefined();
      expect(report.ratios.current_ratio.inputs.current_liabilities).toBeDefined();
    });

    it('scoped to company — company B balances never included', async () => {
      // Company A setup
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-A-001',
        date: new Date('2025-06-30'),
        description: 'Company A',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 100000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 100000 }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        createdBy: userA._id
      });

      // Company B setup - much larger
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2025-06-30'),
        description: 'Company B',
        sourceType: 'opening_balance',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 1000000, credit: 0 },
          { accountCode: '2100', accountName: 'AP', debit: 0, credit: 1000000 }
        ],
        totalDebit: 1000000,
        totalCredit: 1000000,
        createdBy: userB._id
      });

      const reportA = await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      // Company A should only see 100000, not 1000000
      expect(reportA.ratios.current_ratio.inputs.current_assets).toBe(100000);
    });

    it('does not post any journal entries', async () => {
      const before = await JournalEntry.countDocuments({ company: companyA._id });

      await FinancialRatiosService.compute(companyA._id, {
        asOfDate: '2025-06-30',
        dateFrom: '2025-01-01',
        dateTo: '2025-06-30'
      });

      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });
  });
});
