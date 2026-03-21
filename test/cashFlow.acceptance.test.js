const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CashFlowService = require('../services/cashFlowService');
const JournalEntry = require('../models/JournalEntry');
const { BankAccount } = require('../models/BankAccount');
const { PettyCashFloat } = require('../models/PettyCash');

let mongoServer;
let companyA, companyB;
let userA, userB;
let bankAccountA, bankAccountB;
let pettyCashA, pettyCashB;

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

  // Create bank accounts for each company
  bankAccountA = await BankAccount.create({
    company: companyA._id,
    name: 'Main Bank Account',
    accountNumber: '123456',
    bankName: 'Test Bank',
    currencyCode: 'USD',
    ledgerAccountId: '1100',
    openingBalance: 10000,
    openingBalanceDate: new Date('2025-01-01'),
    isActive: true,
    isDefault: true,
    accountType: 'bk_bank'
  });

  bankAccountB = await BankAccount.create({
    company: companyB._id,
    name: 'Main Bank Account',
    accountNumber: '654321',
    bankName: 'Test Bank',
    currencyCode: 'USD',
    ledgerAccountId: '1100',
    openingBalance: 5000,
    openingBalanceDate: new Date('2025-01-01'),
    isActive: true,
    isDefault: true,
    accountType: 'bk_bank'
  });

  // Create petty cash funds for each company
  pettyCashA = await PettyCashFloat.create({
    company: companyA._id,
    name: 'Main Office Petty Cash',
    ledgerAccountId: '1110',
    openingBalance: 1000,
    currentBalance: 1000,
    floatAmount: 1000,
    custodian: userA._id,
    isActive: true
  });

  pettyCashB = await PettyCashFloat.create({
    company: companyB._id,
    name: 'Branch Petty Cash',
    ledgerAccountId: '1110',
    openingBalance: 500,
    currentBalance: 500,
    floatAmount: 500,
    custodian: userB._id,
    isActive: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await JournalEntry.deleteMany({});
});

describe('CashFlowService', () => {

  describe('generate()', () => {
    it('ar_receipt source_type classified as operating inflow', async () => {
      // Create AR receipt journal entry - cash in (debit to bank)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-001',
        date: new Date('2025-06-15'),
        description: 'Customer payment received',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank Account', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'Accounts Receivable', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const arReceipt = report.operating.inflows.find(i => i.source_type === 'ar_receipt');
      expect(arReceipt).toBeDefined();
      expect(arReceipt.cash_in).toBe(5000);
    });

    it('ap_payment source_type classified as operating outflow', async () => {
      // Create AP payment journal entry - cash out (credit to bank)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AP-001',
        date: new Date('2025-06-15'),
        description: 'Supplier payment made',
        sourceType: 'ap_payment',
        status: 'posted',
        lines: [
          { accountCode: '2100', accountName: 'Accounts Payable', debit: 3000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 3000 }
        ],
        totalDebit: 3000,
        totalCredit: 3000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const apPayment = report.operating.outflows.find(o => o.source_type === 'ap_payment');
      expect(apPayment).toBeDefined();
      expect(apPayment.cash_out).toBe(3000);
    });

    it('expense source_type classified as operating outflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-EXP-001',
        date: new Date('2025-06-15'),
        description: 'Rent payment',
        sourceType: 'expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Rent Expense', debit: 2000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 2000 }
        ],
        totalDebit: 2000,
        totalCredit: 2000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const expense = report.operating.outflows.find(o => o.source_type === 'expense');
      expect(expense).toBeDefined();
      expect(expense.cash_out).toBe(2000);
    });

    it('payroll_run source_type classified as operating outflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-PR-001',
        date: new Date('2025-06-30'),
        description: 'Payroll payment',
        sourceType: 'payroll_run',
        status: 'posted',
        lines: [
          { accountCode: '6200', accountName: 'Salaries Expense', debit: 8000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 8000 }
        ],
        totalDebit: 8000,
        totalCredit: 8000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const payroll = report.operating.outflows.find(o => o.source_type === 'payroll_run');
      expect(payroll).toBeDefined();
      expect(payroll.cash_out).toBe(8000);
    });

    it('tax_settlement source_type classified as operating outflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-TAX-001',
        date: new Date('2025-06-20'),
        description: 'VAT payment',
        sourceType: 'tax_settlement',
        status: 'posted',
        lines: [
          { accountCode: '2200', accountName: 'VAT Payable', debit: 1500, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 1500 }
        ],
        totalDebit: 1500,
        totalCredit: 1500,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const tax = report.operating.outflows.find(o => o.source_type === 'tax_settlement');
      expect(tax).toBeDefined();
      expect(tax.cash_out).toBe(1500);
    });

    it('asset_purchase source_type classified as investing outflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AP-ASSET-001',
        date: new Date('2025-06-15'),
        description: 'Purchase of vehicle',
        sourceType: 'asset_purchase',
        status: 'posted',
        lines: [
          { accountCode: '1500', accountName: 'Vehicles', debit: 25000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 25000 }
        ],
        totalDebit: 25000,
        totalCredit: 25000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const assetPurchase = report.investing.outflows.find(o => o.source_type === 'asset_purchase');
      expect(assetPurchase).toBeDefined();
      expect(assetPurchase.cash_out).toBe(25000);
    });

    it('asset_disposal source_type classified as investing inflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AD-001',
        date: new Date('2025-06-15'),
        description: 'Sale of old equipment',
        sourceType: 'asset_disposal',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank Account', debit: 5000, credit: 0 },
          { accountCode: '1510', accountName: 'Accumulated Depreciation', debit: 3000, credit: 0 },
          { accountCode: '1500', accountName: 'Equipment', debit: 0, credit: 5000 },
          { accountCode: '7100', accountName: 'Gain on Sale', debit: 0, credit: 3000 }
        ],
        totalDebit: 8000,
        totalCredit: 8000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const assetDisposal = report.investing.inflows.find(i => i.source_type === 'asset_disposal');
      expect(assetDisposal).toBeDefined();
      expect(assetDisposal.cash_in).toBe(5000);
    });

    it('liability_drawdown source_type classified as financing inflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-LD-001',
        date: new Date('2025-06-10'),
        description: 'Bank loan received',
        sourceType: 'liability_drawdown',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank Account', debit: 50000, credit: 0 },
          { accountCode: '3000', accountName: 'Bank Loan', debit: 0, credit: 50000 }
        ],
        totalDebit: 50000,
        totalCredit: 50000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const drawdown = report.financing.inflows.find(i => i.source_type === 'liability_drawdown');
      expect(drawdown).toBeDefined();
      expect(drawdown.cash_in).toBe(50000);
    });

    it('liability_repayment source_type classified as financing outflow', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-LR-001',
        date: new Date('2025-06-25'),
        description: 'Loan repayment',
        sourceType: 'liability_repayment',
        status: 'posted',
        lines: [
          { accountCode: '3000', accountName: 'Bank Loan', debit: 5000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank Account', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const repayment = report.financing.outflows.find(o => o.source_type === 'liability_repayment');
      expect(repayment).toBeDefined();
      expect(repayment.cash_out).toBe(5000);
    });

    it('net_change_in_cash = operating + investing + financing totals', async () => {
      // Operating: AR receipt 5000, AP payment 3000 (net +2000)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-002',
        date: new Date('2025-06-15'),
        description: 'Customer payment',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AP-002',
        date: new Date('2025-06-16'),
        description: 'Supplier payment',
        sourceType: 'ap_payment',
        status: 'posted',
        lines: [
          { accountCode: '2100', accountName: 'AP', debit: 3000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 3000 }
        ],
        totalDebit: 3000,
        totalCredit: 3000,
        createdBy: userA._id
      });

      // Investing: Asset purchase 10000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-ASP-002',
        date: new Date('2025-06-17'),
        description: 'Asset purchase',
        sourceType: 'asset_purchase',
        status: 'posted',
        lines: [
          { accountCode: '1500', accountName: 'Asset', debit: 10000, credit: 0 },
          { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 10000 }
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        createdBy: userA._id
      });

      // Financing: Loan 20000
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-LD-002',
        date: new Date('2025-06-18'),
        description: 'Loan drawdown',
        sourceType: 'liability_drawdown',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 20000, credit: 0 },
          { accountCode: '3000', accountName: 'Loan', debit: 0, credit: 20000 }
        ],
        totalDebit: 20000,
        totalCredit: 20000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const expectedNetChange = 
        report.operating.net_cash_from_operating + 
        report.investing.net_cash_from_investing + 
        report.financing.net_cash_from_financing;

      expect(report.net_change_in_cash).toBe(expectedNetChange);
      // Operating: +2000, Investing: -10000, Financing: +20000 = +12000
      expect(report.net_change_in_cash).toBe(12000);
    });

    it('opening + net_change = closing_cash_balance', async () => {
      // Create some cash movements
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-003',
        date: new Date('2025-06-15'),
        description: 'Customer payment',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 10000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 10000 }
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const computedClosing = report.opening_cash_balance + report.net_change_in_cash;
      expect(report.computed_closing_balance).toBe(computedClosing);
    });

    it('is_reconciled true when opening + net_change equals closing within 0.01', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-004',
        date: new Date('2025-06-15'),
        description: 'Customer payment',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      expect(report.is_reconciled).toBe(true);
      expect(report.reconciliation_diff).toBeLessThan(0.01);
    });

    it('includes both bank and petty cash accounts in cash balance', async () => {
      // Cash movement through bank
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-005',
        date: new Date('2025-06-15'),
        description: 'Customer payment to bank',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 10000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 10000 }
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        createdBy: userA._id
      });

      // Cash movement through petty cash
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-PC-001',
        date: new Date('2025-06-16'),
        description: 'Petty cash expense',
        sourceType: 'petty_cash_expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Expense', debit: 200, credit: 0 },
          { accountCode: '1110', accountName: 'Petty Cash', debit: 0, credit: 200 }
        ],
        totalDebit: 200,
        totalCredit: 200,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      // Should have both operating inflow (ar_receipt) and outflow (petty_cash_expense)
      expect(report.operating.inflows.some(i => i.source_type === 'ar_receipt')).toBe(true);
      expect(report.operating.outflows.some(o => o.source_type === 'petty_cash_expense')).toBe(true);
    });

    it('excludes draft and reversed journal entries', async () => {
      // Posted entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-006',
        date: new Date('2025-06-15'),
        description: 'Posted AR receipt',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      // Draft entry - should be excluded
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-DRAFT-001',
        date: new Date('2025-06-16'),
        description: 'Draft entry',
        sourceType: 'ar_receipt',
        status: 'draft',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 3000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 3000 }
        ],
        totalDebit: 3000,
        totalCredit: 3000,
        createdBy: userA._id
      });

      // Reversed entry - should be excluded
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-REV-001',
        date: new Date('2025-06-17'),
        description: 'Reversed entry',
        sourceType: 'ar_receipt',
        status: 'reversed',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 2000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 2000 }
        ],
        totalDebit: 2000,
        totalCredit: 2000,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const arReceipt = report.operating.inflows.find(i => i.source_type === 'ar_receipt');
      expect(arReceipt.cash_in).toBe(5000); // Only posted entry included
    });

    it('scoped to company — company B cash movements never appear', async () => {
      // Company A entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-A-001',
        date: new Date('2025-06-15'),
        description: 'Company A receipt',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 10000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 10000 }
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        createdBy: userA._id
      });

      // Company B entry
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2025-06-15'),
        description: 'Company B receipt',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 50000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 50000 }
        ],
        totalDebit: 50000,
        totalCredit: 50000,
        createdBy: userB._id
      });

      const reportA = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const reportB = await CashFlowService.generate(companyB._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      // Company A should only see 10000
      expect(reportA.operating.inflows[0].cash_in).toBe(10000);
      
      // Company B should only see 50000
      expect(reportB.operating.inflows[0].cash_in).toBe(50000);
    });

    it('all amounts rounded to 2 decimal places', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-AR-007',
        date: new Date('2025-06-15'),
        description: 'Payment with decimals',
        sourceType: 'ar_receipt',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 1234.567, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 1234.567 }
        ],
        totalDebit: 1234.567,
        totalCredit: 1234.567,
        createdBy: userA._id
      });

      const report = await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      // All cash amounts should be rounded to 2 decimal places
      const cashIn = report.operating.inflows[0].cash_in;
      expect(cashIn).toBe(1234.57);
      expect(cashIn.toString().split('.')[1].length).toBe(2);
    });

    it('does not post any journal entries', async () => {
      const before = await JournalEntry.countDocuments({ company: companyA._id });

      await CashFlowService.generate(companyA._id, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30'
      });

      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });
  });
});
