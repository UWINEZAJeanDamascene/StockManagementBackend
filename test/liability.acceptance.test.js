const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const Liability = require('../models/Liability');
const LiabilityService = require('../services/liabilityService');
const ChartOfAccount = require('../models/ChartOfAccount');
const { BankAccount } = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const Company = require('../models/Company');
const User = require('../models/User');
const AccountingPeriod = require('../models/AccountingPeriod');

let mongoServer;
let companyA, companyB;
let userA, userB;
let bankAccountA, bankAccountB;
let liabilityAccountA, liabilityAccountB;
let interestAccountA, interestAccountB;
let companyIdA, companyIdB;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  // Create company A
  companyA = await Company.create({
    name: 'Test Company A',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@companya.com'
  });
  companyIdA = companyA._id;

  // Create company B
  companyB = await Company.create({
    name: 'Test Company B',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@companyb.com'
  });
  companyIdB = companyB._id;

  // Create users
  userA = await User.create({
    name: 'Test User A',
    email: `test-a-${Date.now()}@example.com`,
    password: 'password123',
    company: companyIdA,
    role: 'admin'
  });

  userB = await User.create({
    name: 'Test User B',
    email: `test-b-${Date.now()}@example.com`,
    password: 'password123',
    company: companyIdB,
    role: 'admin'
  });

  // Create bank accounts
  bankAccountA = await BankAccount.create({
    company: companyIdA,
    name: 'Company A Bank',
    accountNumber: '1234567890',
    accountType: 'bk_bank',
    balance: 0,
    openingBalanceDate: new Date(),
    isActive: true,
    currencyCode: 'USD',
    createdBy: userA._id,
    ledgerAccountId: await ChartOfAccount.create({
      company: companyIdA,
      code: '1100',
      name: 'Cash at Bank',
      type: 'asset',
      isActive: true
    })
  });

  bankAccountB = await BankAccount.create({
    company: companyIdB,
    name: 'Company B Bank',
    accountNumber: '0987654321',
    accountType: 'bk_bank',
    balance: 0,
    openingBalanceDate: new Date(),
    isActive: true,
    currencyCode: 'USD',
    createdBy: userB._id,
    ledgerAccountId: await ChartOfAccount.create({
      company: companyIdB,
      code: '1100',
      name: 'Cash at Bank',
      type: 'asset',
      isActive: true
    })
  });

  // Create liability accounts
  liabilityAccountA = await ChartOfAccount.create({
    company: companyIdA,
    code: '2100',
    name: 'Long-term Liabilities',
    type: 'liability',
    isActive: true
  });

  liabilityAccountB = await ChartOfAccount.create({
    company: companyIdB,
    code: '2100',
    name: 'Long-term Liabilities',
    type: 'liability',
    isActive: true
  });

  // Create interest expense accounts
  interestAccountA = await ChartOfAccount.create({
    company: companyIdA,
    code: '6100',
    name: 'Interest Expense',
    type: 'expense',
    isActive: true
  });

  interestAccountB = await ChartOfAccount.create({
    company: companyIdB,
    code: '6100',
    name: 'Interest Expense',
    type: 'expense',
    isActive: true
  });

  // Create accounting periods for 2024 (tests use dates in 2024)
  const periods2024 = [
    { company_id: companyIdA, name: 'Jan 2024', period_type: 'month', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Feb 2024', period_type: 'month', start_date: new Date('2024-02-01'), end_date: new Date('2024-02-29'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Mar 2024', period_type: 'month', start_date: new Date('2024-03-01'), end_date: new Date('2024-03-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Apr 2024', period_type: 'month', start_date: new Date('2024-04-01'), end_date: new Date('2024-04-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'May 2024', period_type: 'month', start_date: new Date('2024-05-01'), end_date: new Date('2024-05-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Jun 2024', period_type: 'month', start_date: new Date('2024-06-01'), end_date: new Date('2024-06-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Jul 2024', period_type: 'month', start_date: new Date('2024-07-01'), end_date: new Date('2024-07-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Aug 2024', period_type: 'month', start_date: new Date('2024-08-01'), end_date: new Date('2024-08-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Sep 2024', period_type: 'month', start_date: new Date('2024-09-01'), end_date: new Date('2024-09-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Oct 2024', period_type: 'month', start_date: new Date('2024-10-01'), end_date: new Date('2024-10-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Nov 2024', period_type: 'month', start_date: new Date('2024-11-01'), end_date: new Date('2024-11-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdA, name: 'Dec 2024', period_type: 'month', start_date: new Date('2024-12-01'), end_date: new Date('2024-12-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Jan 2024', period_type: 'month', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Feb 2024', period_type: 'month', start_date: new Date('2024-02-01'), end_date: new Date('2024-02-29'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Mar 2024', period_type: 'month', start_date: new Date('2024-03-01'), end_date: new Date('2024-03-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Apr 2024', period_type: 'month', start_date: new Date('2024-04-01'), end_date: new Date('2024-04-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'May 2024', period_type: 'month', start_date: new Date('2024-05-01'), end_date: new Date('2024-05-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Jun 2024', period_type: 'month', start_date: new Date('2024-06-01'), end_date: new Date('2024-06-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Jul 2024', period_type: 'month', start_date: new Date('2024-07-01'), end_date: new Date('2024-07-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Aug 2024', period_type: 'month', start_date: new Date('2024-08-01'), end_date: new Date('2024-08-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Sep 2024', period_type: 'month', start_date: new Date('2024-09-01'), end_date: new Date('2024-09-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Oct 2024', period_type: 'month', start_date: new Date('2024-10-01'), end_date: new Date('2024-10-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Nov 2024', period_type: 'month', start_date: new Date('2024-11-01'), end_date: new Date('2024-11-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyIdB, name: 'Dec 2024', period_type: 'month', start_date: new Date('2024-12-01'), end_date: new Date('2024-12-31'), fiscal_year: 2024, status: 'open' }
  ];
  await AccountingPeriod.insertMany(periods2024);
});

// Helper to coerce Decimal128 / numeric-like fields into JS numbers for assertions
function numeric(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Number(val);
  if (typeof val === 'object') {
    if (val.$numberDecimal) return Number(val.$numberDecimal);
    try { return Number(val.toString()); } catch (e) { return 0; }
  }
  return Number(val);
}

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const collections = Object.keys(mongoose.connection.collections);
  // Keep core reference data across tests (companies, users, chart of accounts, bank accounts, accounting periods)
  const keep = new Set(['companies', 'users', 'chartofaccounts', 'bankaccounts', 'accountingperiods']);
  for (const name of collections) {
    if (keep.has(name)) continue;
    try {
      await mongoose.connection.collections[name].deleteMany({});
    } catch (e) {
      // ignore errors on collections that may not exist in some runs
    }
  }
});

describe('Module 6 - Liabilities Acceptance Tests', () => {

  // Test 1: Creating a liability posts DR Bank / CR Liability — balanced
  describe('Test 1: Create liability with journal entry', () => {
    it('should create liability and post balanced journal entry', async () => {
      const validData = {
        name: 'Test Loan',
        type: 'loan',
        principalAmount: 10000,
        liabilityAccountId: liabilityAccountA._id,
        interestExpenseAccountId: interestAccountA._id,
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01'),
        interestRatePct: 5
      };

      const liability = await LiabilityService.create(companyIdA, validData, userA._id);

      expect(liability).toBeDefined();
      expect(liability.company_id.toString()).toBe(companyIdA.toString());
      expect(liability.name).toBe('Test Loan');
      expect(liability.type).toBe('loan');
      expect(liability.principalAmount).toBe(10000);
      expect(liability.outstandingBalance).toBe(10000);
      expect(liability.status).toBe('active');

      // Verify journal entry was created
      const entry = await JournalEntry.findById(liability.journalEntryId);
      expect(entry).toBeDefined();
      
      // Check balance
      const totalDr = entry.lines.reduce((sum, line) => sum + numeric(line.debit || 0), 0);
      const totalCr = entry.lines.reduce((sum, line) => sum + numeric(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(10000);
    });
  });

  // Test 2: reference_no is unique per company
  describe('Test 2: Reference number uniqueness', () => {
    it('should allow same reference in different companies', async () => {
      const validData = {
        name: 'Company A Loan',
        type: 'loan',
        principalAmount: 5000,
        liabilityAccountId: liabilityAccountA._id,
        interestExpenseAccountId: interestAccountA._id,
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01')
      };

      const liabA = await LiabilityService.create(companyIdA, validData, userA._id);
      
      // Company B gets same reference number
      const validDataB = {
        ...validData,
        name: 'Company B Loan',
        liabilityAccountId: liabilityAccountB._id,
        interestExpenseAccountId: interestAccountB._id,
        bankAccountId: bankAccountB._id
      };
      
      const liabB = await LiabilityService.create(companyIdB, validDataB, userB._id);

      expect(liabA.reference_no).toBe('LIB-00001');
      expect(liabB.reference_no).toBe('LIB-00001');
      expect(liabA.reference_no).toBe(liabB.reference_no);
    });
  });

  // Test 3: Cannot use account from different company
  describe('Test 3: Account validation', () => {
    it('should reject liability account from different company', async () => {
      const invalidData = {
        name: 'Invalid Loan',
        type: 'loan',
        principalAmount: 5000,
        liabilityAccountId: liabilityAccountB._id, // From company B!
        interestExpenseAccountId: interestAccountA._id,
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01')
      };

      await expect(
        LiabilityService.create(companyIdA, invalidData, userA._id)
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  // Test 4-8: Repayment tests
  describe('Test 4-8: Post Repayment', () => {
    let testLiability;

    beforeEach(async () => {
      const validData = {
        name: 'Repayment Test Loan',
        type: 'loan',
        principalAmount: 10000,
        liabilityAccountId: liabilityAccountA._id,
        interestExpenseAccountId: interestAccountA._id,
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01')
      };
      testLiability = await LiabilityService.create(companyIdA, validData, userA._id);
    });

    it('Test 4: should post balanced journal entry for repayment', async () => {
      const repaymentData = {
        principalPortion: 2000,
        interestPortion: 100,
        bankAccountId: bankAccountA._id,
        paymentDate: new Date('2024-02-01')
      };

      const updatedLiability = await LiabilityService.postRepayment(
        companyIdA, 
        testLiability._id, 
        repaymentData, 
        userA._id
      );

      expect(updatedLiability).toBeDefined();
      
      // Find the journal entry
      const entries = await JournalEntry.find({ 
        company: companyIdA,
        sourceType: 'liability_repayment'
      });
      
      const repaymentEntry = entries[entries.length - 1];
      expect(repaymentEntry).toBeDefined();

      // Check balance
      const totalDr = repaymentEntry.lines.reduce((sum, line) => sum + numeric(line.debit || 0), 0);
      const totalCr = repaymentEntry.lines.reduce((sum, line) => sum + numeric(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(2100); // 2000 principal + 100 interest
    });

    it('Test 5: should reduce outstanding balance by principal portion', async () => {
      const repaymentData = {
        principalPortion: 3000,
        interestPortion: 150,
        bankAccountId: bankAccountA._id,
        paymentDate: new Date('2024-02-01')
      };

      const updatedLiability = await LiabilityService.postRepayment(
        companyIdA, 
        testLiability._id, 
        repaymentData, 
        userA._id
      );

      expect(updatedLiability.outstandingBalance).toBe(7000); // 10000 - 3000
    });

    it('Test 6: should set status to fully_repaid when balance reaches zero', async () => {
      const repaymentData = {
        principalPortion: 10000,
        interestPortion: 500,
        bankAccountId: bankAccountA._id,
        paymentDate: new Date('2024-02-01')
      };

      const updatedLiability = await LiabilityService.postRepayment(
        companyIdA, 
        testLiability._id, 
        repaymentData, 
        userA._id
      );

      expect(updatedLiability.outstandingBalance).toBe(0);
      expect(updatedLiability.status).toBe('fully_repaid');
    });

    it('Test 7: should throw REPAYMENT_EXCEEDS_OUTSTANDING when principal > balance', async () => {
      const invalidData = {
        principalPortion: 15000, // More than outstanding!
        interestPortion: 100,
        bankAccountId: bankAccountA._id,
        paymentDate: new Date('2024-02-01')
      };

      await expect(
        LiabilityService.postRepayment(companyIdA, testLiability._id, invalidData, userA._id)
      ).rejects.toThrow('REPAYMENT_EXCEEDS_OUTSTANDING');
    });

    it('Test 8: cannot access liability from different company', async () => {
      const repaymentData = {
        principalPortion: 1000,
        interestPortion: 50,
        bankAccountId: bankAccountB._id,
        paymentDate: new Date('2024-02-01')
      };

      // Try to access company A's liability with company B's credentials
      await expect(
        LiabilityService.postRepayment(companyIdB, testLiability._id, repaymentData, userB._id)
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  // Test 9-10: Interest tests
  describe('Test 9-10: Post Interest', () => {
    let testLiability;

    beforeEach(async () => {
      const validData = {
        name: 'Interest Test Loan',
        type: 'loan',
        principalAmount: 10000,
        liabilityAccountId: liabilityAccountA._id,
        interestExpenseAccountId: interestAccountA._id,
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01')
      };
      testLiability = await LiabilityService.create(companyIdA, validData, userA._id);
    });

    it('Test 9: should post DR Interest Expense / CR Liability — balanced, no cash movement', async () => {
      const interestData = {
        amount: 500,
        chargeDate: new Date('2024-01-31')
      };

      const updatedLiability = await LiabilityService.postInterest(
        companyIdA,
        testLiability._id,
        interestData,
        userA._id
      );

      expect(updatedLiability).toBeDefined();

      // Find the journal entry
      const entries = await JournalEntry.find({ 
        company: companyIdA,
        sourceType: 'liability_interest'
      });
      
      const interestEntry = entries[entries.length - 1];
      expect(interestEntry).toBeDefined();

      // Check balance - DR should equal CR
      const totalDr = interestEntry.lines.reduce((sum, line) => sum + numeric(line.debit || 0), 0);
      const totalCr = interestEntry.lines.reduce((sum, line) => sum + numeric(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(500);

      // No bank account involved (no cash movement)
      const hasBankLine = interestEntry.lines.some(line => 
        line.accountCode === '1100' || line.accountName?.includes('Bank')
      );
      expect(hasBankLine).toBe(false);
    });

    it('Test 10: should throw INTEREST_ACCOUNT_NOT_CONFIGURED when account not set', async () => {
      // Create liability without interest account
      const noInterestData = {
        name: 'No Interest Loan',
        type: 'loan',
        principalAmount: 5000,
        liabilityAccountId: liabilityAccountA._id,
        // No interestExpenseAccountId!
        bankAccountId: bankAccountA._id,
        startDate: new Date('2024-01-01')
      };
      
      const noInterestLiability = await LiabilityService.create(companyIdA, noInterestData, userA._id);

      const interestData = {
        amount: 200,
        chargeDate: new Date('2024-01-31')
      };

      await expect(
        LiabilityService.postInterest(companyIdA, noInterestLiability._id, interestData, userA._id)
      ).rejects.toThrow('INTEREST_ACCOUNT_NOT_CONFIGURED');
    });
  });
});
