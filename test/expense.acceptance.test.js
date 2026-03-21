const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const Expense = require('../models/Expense');
const ExpenseService = require('../services/expenseService');
const ChartOfAccount = require('../models/ChartOfAccount');
const { BankAccount } = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const Company = require('../models/Company');
const User = require('../models/User');
const PettyCashFund = require('../models/PettyCash').PettyCashFloat;
const AccountingPeriod = require('../models/AccountingPeriod');

let mongoServer;
let companyA, companyB;
let userA, userB;
let bankAccountA, bankAccountB;
let expenseAccountA, expenseAccountB;
let taxAccountA, taxAccountB;
let pettyCashFundA, pettyCashFundB;
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
    accountCode: '1100',
    currentBalance: 10000
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
    accountCode: '1100',
    currentBalance: 10000
  });

  // Create expense accounts
  expenseAccountA = await ChartOfAccount.create({
    company: companyIdA,
    code: '6100',
    name: 'Other Expenses',
    type: 'expense',
    subtype: 'operating',
    isActive: true
  });

  expenseAccountB = await ChartOfAccount.create({
    company: companyIdB,
    code: '6100',
    name: 'Other Expenses',
    type: 'expense',
    subtype: 'operating',
    isActive: true
  });

  // Create tax accounts
  taxAccountA = await ChartOfAccount.create({
    company: companyIdA,
    code: '1500',
    name: 'VAT Receivable',
    type: 'asset',
    subtype: 'current',
    isActive: true
  });

  taxAccountB = await ChartOfAccount.create({
    company: companyIdB,
    code: '1500',
    name: 'VAT Receivable',
    type: 'asset',
    subtype: 'current',
    isActive: true
  });

  // Debug: list chart accounts created
  try {
    const chartsA = await ChartOfAccount.find({ company: companyIdA }).lean();
    const chartsB = await ChartOfAccount.find({ company: companyIdB }).lean();
    console.log('DEBUG: companyIdA', companyIdA && companyIdA.toString());
    console.log('DEBUG: companyIdB', companyIdB && companyIdB.toString());
    console.log('DEBUG: charts for A', chartsA.map(c => ({ id: c._id.toString(), code: c.code, company: c.company && c.company.toString() })));
    console.log('DEBUG: charts for B', chartsB.map(c => ({ id: c._id.toString(), code: c.code, company: c.company && c.company.toString() })));
  } catch (e) {
    console.error('DEBUG: failed to list charts', e);
  }

  // Create petty cash funds
  pettyCashFundA = await PettyCashFund.create({
    company: companyIdA,
    name: 'Petty Cash A',
    openingBalance: 500,
    currentBalance: 500,
    createdBy: userA._id,
    custodian: userA._id
  });

  pettyCashFundB = await PettyCashFund.create({
    company: companyIdB,
    name: 'Petty Cash B',
    openingBalance: 500,
    currentBalance: 500,
    createdBy: userB._id,
    custodian: userB._id
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

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});
// Keep data created in beforeAll for the full suite; do not wipe collections after each test.
afterEach(async () => {});

describe('ExpenseService', () => {

  function toNumber(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val) || 0;
    if (val && typeof val === 'object') {
      if (val.toString) return parseFloat(val.toString()) || 0;
      if (val.$numberDecimal) return parseFloat(val.$numberDecimal) || 0;
    }
    return Number(val) || 0;
  }


  describe('post()', () => {
    
    it('bank expense posts DR Expense + DR VAT / CR Bank — balanced', async () => {
      const validData = {
        description: 'Office Supplies',
        expense_account_id: expenseAccountA._id,
        amount: 100,
        tax_amount: 10,
        tax_account_id: taxAccountA._id,
        payment_method: 'bank',
        bank_account_id: bankAccountA._id,
        expense_date: new Date('2024-01-15')
      };

      const expense = await ExpenseService.post(companyIdA, validData, userA._id);

      expect(expense).toBeDefined();
      expect(expense.company.toString()).toBe(companyIdA.toString());
      expect(expense.description).toBe('Office Supplies');
      expect(expense.amount).toBe(100);
      expect(expense.tax_amount).toBe(10);
      expect(expense.total_amount).toBe(110);
      expect(expense.status).toBe('posted');

      // Verify journal entry was created
      const entry = await JournalEntry.findById(expense.journal_entry_id);
      expect(entry).toBeDefined();
      
      // Check balance
      const totalDr = entry.lines.reduce((sum, line) => sum + toNumber(line.debit || 0), 0);
      const totalCr = entry.lines.reduce((sum, line) => sum + toNumber(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(110); // 100 + 10 tax
    });

    it('petty_cash expense posts DR Expense / CR Petty Cash — balanced', async () => {
      const validData = {
        description: 'Office Supplies',
        expense_account_id: expenseAccountA._id,
        amount: 50,
        payment_method: 'petty_cash',
        petty_cash_fund_id: pettyCashFundA._id,
        expense_date: new Date('2024-01-15')
      };

      const expense = await ExpenseService.post(companyIdA, validData, userA._id);

      expect(expense).toBeDefined();
      expect(expense.payment_method).toBe('petty_cash');
      expect(expense.status).toBe('posted');

      // Verify journal entry was created
      const entry = await JournalEntry.findById(expense.journal_entry_id);
      expect(entry).toBeDefined();
      
      // Check balance
      const totalDr = entry.lines.reduce((sum, line) => sum + toNumber(line.debit || 0), 0);
      const totalCr = entry.lines.reduce((sum, line) => sum + toNumber(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(50);
    });

    it('payable expense posts DR Expense / CR Accrued Liabilities — balanced', async () => {
      const validData = {
        description: 'Accrued Expense',
        expense_account_id: expenseAccountA._id,
        amount: 300,
        payment_method: 'payable',
        expense_date: new Date('2024-01-15')
      };

      const expense = await ExpenseService.post(companyIdA, validData, userA._id);

      expect(expense).toBeDefined();
      expect(expense.payment_method).toBe('payable');
      expect(expense.status).toBe('posted');

      // Verify journal entry was created
      const entry = await JournalEntry.findById(expense.journal_entry_id);
      expect(entry).toBeDefined();
      
      // Check balance - should be balanced
      const totalDr = entry.lines.reduce((sum, line) => sum + toNumber(line.debit || 0), 0);
      const totalCr = entry.lines.reduce((sum, line) => sum + toNumber(line.credit || 0), 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(300);
    });

    it('petty_cash expense fails with INSUFFICIENT_PETTY_CASH when fund balance too low', async () => {
      // First, create a small petty cash fund
      const smallFund = await PettyCashFund.create({
        company: companyIdA,
        name: 'Small Petty Cash',
        openingBalance: 10,
        currentBalance: 10,
        createdBy: userA._id,
        custodian: userA._id
      });

      const invalidData = {
        description: 'Large Expense',
        expense_account_id: expenseAccountA._id,
        amount: 100, // More than fund balance!
        payment_method: 'petty_cash',
        petty_cash_fund_id: smallFund._id,
        expense_date: new Date('2024-01-15')
      };

      await expect(
        ExpenseService.post(companyIdA, invalidData, userA._id)
      ).rejects.toThrow('INSUFFICIENT_PETTY_CASH');
    });

    it('bank_account_id from different company throws NOT_FOUND', async () => {
      const invalidData = {
        description: 'Office Supplies',
        expense_account_id: expenseAccountA._id,
        amount: 100,
        payment_method: 'bank',
        bank_account_id: bankAccountB._id, // Company B's bank account!
        expense_date: new Date('2024-01-15')
      };

      await expect(
        ExpenseService.post(companyIdA, invalidData, userA._id)
      ).rejects.toThrow('NOT_FOUND');
    });

    it('expense_account_id from different company throws NOT_FOUND', async () => {
      const invalidData = {
        description: 'Office Supplies',
        expense_account_id: expenseAccountB._id, // Company B's expense account!
        amount: 100,
        payment_method: 'bank',
        bank_account_id: bankAccountA._id,
        expense_date: new Date('2024-01-15')
      };

      await expect(
        ExpenseService.post(companyIdA, invalidData, userA._id)
      ).rejects.toThrow('NOT_FOUND');
    });

    it('company A expense is not visible to company B', async () => {
      const validData = {
        description: 'Company A Expense',
        expense_account_id: expenseAccountA._id,
        amount: 100,
        payment_method: 'bank',
        bank_account_id: bankAccountA._id,
        expense_date: new Date('2024-01-15')
      };

      const expense = await ExpenseService.post(companyIdA, validData, userA._id);

      // Try to find it from company B's perspective
      const expenseFromCompanyB = await Expense.findOne({
        _id: expense._id,
        company: companyIdB
      });

      expect(expenseFromCompanyB).toBeNull();
    });
  });

  describe('reverse()', () => {
    let testExpense;

    beforeEach(async () => {
      const validData = {
        description: 'Expense to Reverse',
        expense_account_id: expenseAccountA._id,
        amount: 150,
        payment_method: 'bank',
        bank_account_id: bankAccountA._id,
        expense_date: new Date('2024-01-15')
      };
      testExpense = await ExpenseService.post(companyIdA, validData, userA._id);
    });

    it('posts exact inverse journal entry', async () => {
      const reversalData = {
        reason: 'Duplicate entry',
        reversal_date: new Date('2024-01-16')
      };

      const reversedExpense = await ExpenseService.reverse(
        companyIdA,
        testExpense._id,
        reversalData,
        userA._id
      );

      expect(reversedExpense).toBeDefined();
      expect(reversedExpense.reversal_journal_entry_id).toBeDefined();

      // Get both journal entries
      const originalEntry = await JournalEntry.findById(testExpense.journal_entry_id);
      const reversalEntry = await JournalEntry.findById(reversedExpense.reversal_journal_entry_id);

      // Verify reversal entry has exact inverse amounts
      originalEntry.lines.forEach((line, index) => {
        const reversalLine = reversalEntry.lines[index];
        expect(toNumber(reversalLine.debit)).toBe(toNumber(line.credit || 0));
        expect(toNumber(reversalLine.credit)).toBe(toNumber(line.debit || 0));
        expect(reversalLine.accountCode).toBe(line.accountCode);
      });
    });

    it('sets expense status to reversed', async () => {
      const reversalData = {
        reason: 'Test reversal',
        reversal_date: new Date('2024-01-16')
      };

      const reversedExpense = await ExpenseService.reverse(
        companyIdA,
        testExpense._id,
        reversalData,
        userA._id
      );

      expect(reversedExpense.status).toBe('reversed');

      // Verify in database
      const updatedExpense = await Expense.findById(testExpense._id);
      expect(updatedExpense.status).toBe('reversed');
    });

    it('throws EXPENSE_ALREADY_REVERSED on second reversal', async () => {
      const reversalData = {
        reason: 'First reversal',
        reversal_date: new Date('2024-01-16')
      };

      // First reversal should succeed
      await ExpenseService.reverse(companyIdA, testExpense._id, reversalData, userA._id);

      // Second reversal should fail
      await expect(
        ExpenseService.reverse(companyIdA, testExpense._id, { reason: 'Second attempt' }, userA._id)
      ).rejects.toThrow('EXPENSE_ALREADY_REVERSED');
    });
  });
});
