const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const GeneralLedgerService = require('../services/generalLedgerService');
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

describe('GeneralLedgerService', () => {
  let companyA, companyB;
  let debitAccount, creditAccount;
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

    // Create a debit-normal account (e.g., Cash - code 1000)
    debitAccount = await ChartOfAccount.create({
      company: companyA._id,
      name: 'Cash Account',
      code: '1000',
      type: 'asset',
      normal_balance: 'debit',
      isActive: true,
      allowDirectPosting: true
    });

    // Create a credit-normal account (e.g., Sales Revenue - code 4100)
    creditAccount = await ChartOfAccount.create({
      company: companyA._id,
      name: 'Sales Revenue',
      code: '4100',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true,
      allowDirectPosting: true
    });
  });

  afterEach(async () => {
    await JournalEntry.deleteMany({});
    await ChartOfAccount.deleteMany({});
    await User.deleteMany({});
    await Company.deleteMany({});
  });

  describe('getAccountLedger()', () => {
    it('opening_balance equals sum of all activity before date_from', async () => {
      // Create journal entries before the period
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-01-01'),
        description: 'Entry before period',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      // Create journal entries in the period
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-15'),
        description: 'Entry in period',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 200 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.opening_balance).toBe(500);
    });

    it('running balance correct after each line for debit-normal account', async () => {
      // Create multiple entries in period
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-10'),
        description: 'Entry 1',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-20'),
        description: 'Entry 2',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      // Opening balance = 0 (no activity before)
      // Line 1: 0 + 100 - 0 = 100
      // Line 2: 100 + 50 - 0 = 150
      expect(result.lines[0].balance).toBe(100);
      expect(result.lines[1].balance).toBe(150);
    });

    it('running balance correct after each line for credit-normal account', async () => {
      // Create entries for credit-normal account (Sales Revenue)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-10'),
        description: 'Sale 1',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-20'),
        description: 'Sale 2',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        creditAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      // For credit-normal: balance = opening + credit - debit
      // Opening = 0
      // Line 1: 0 + 100 - 0 = 100
      // Line 2: 100 + 50 - 0 = 150
      expect(result.lines[0].balance).toBe(100);
      expect(result.lines[1].balance).toBe(150);
    });

    it('closing_balance = opening_balance + total_dr - total_cr for debit accounts', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Entry with DR',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 300 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.closing_balance).toBe(result.opening_balance + result.total_dr - result.total_cr);
    });

    it('closing_balance = opening_balance + total_cr - total_dr for credit accounts', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Sale',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        creditAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.closing_balance).toBe(result.opening_balance + result.total_cr - result.total_dr);
    });

    it('lines sorted by entry_date ascending then by _id ascending', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-20'),
        description: 'Entry on 20th',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-10'),
        description: 'Entry on 10th',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(new Date(result.lines[0].date)).toEqual(new Date('2024-06-10'));
      expect(new Date(result.lines[1].date)).toEqual(new Date('2024-06-20'));
    });

    it('excludes draft and reversed journal entries', async () => {
      // Create posted entry
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Posted entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      // Create draft entry (should be excluded)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-002',
        date: new Date('2024-06-16'),
        description: 'Draft entry',
        status: 'draft',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 200, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 200 }
        ]
      });

      // Create reversed entry (should be excluded)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-003',
        date: new Date('2024-06-17'),
        description: 'Reversed entry',
        status: 'reversed',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 300, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 300 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.lines.length).toBe(1);
      expect(result.lines[0].narration).toBe('Posted entry');
    });

    it('includes source_type and source_id for drill-through capability', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Entry from invoice',
        status: 'posted',
        sourceType: 'invoice',
        sourceId: new mongoose.Types.ObjectId(),
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.lines[0].source_type).toBe('invoice');
      expect(result.lines[0].source_id).toBeDefined();
    });

    it('throws ACCOUNT_NOT_FOUND when account belongs to different company', async () => {
      // Create account for company B
      const companyBAccount = await ChartOfAccount.create({
        company: companyB._id,
        name: 'Company B Account',
        code: '9999',
        type: 'asset',
        normal_balance: 'debit',
        isActive: true
      });

      // Try to access with company A's credentials
      await expect(
        GeneralLedgerService.getAccountLedger(
          companyA._id.toString(),
          companyBAccount._id.toString(),
          { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
        )
      ).rejects.toThrow('ACCOUNT_NOT_FOUND');
    });

    it('scoped to company — lines from other companies never appear', async () => {
      // Create entry for company B
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2024-06-15'),
        description: 'Company B entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 1000 }
        ]
      });

      // Create entry for company A
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Company A entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.lines.length).toBe(1);
      expect(result.lines[0].narration).toBe('Company A entry');
      expect(result.total_dr).toBe(50);
    });

    it('all amounts rounded to 2 decimal places', async () => {
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-06-15'),
        description: 'Entry with decimals',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 100.456, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 100.456 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      // Check that amounts are rounded to 2 decimal places
      expect(result.lines[0].dr_amount).toBe(100.46);
      expect(result.lines[0].balance).toBe(100.46);
      expect(result.total_dr).toBe(100.46);
      expect(result.closing_balance).toBe(100.46);
    });

    it('returns empty lines with opening_balance when no activity in period', async () => {
      // Create entry before the period
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2024-01-01'),
        description: 'Old entry',
        status: 'posted',
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      });

      const result = await GeneralLedgerService.getAccountLedger(
        companyA._id.toString(),
        debitAccount._id.toString(),
        { dateFrom: '2024-06-01', dateTo: '2024-06-30' }
      );

      expect(result.lines.length).toBe(0);
      expect(result.opening_balance).toBe(500);
      expect(result.closing_balance).toBe(500);
      expect(result.total_dr).toBe(0);
      expect(result.total_cr).toBe(0);
    });
  });
});
