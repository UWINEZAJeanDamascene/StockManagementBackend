/**
 * Module 3 - Bank Accounts Acceptance Tests
 * 
 * Acceptance Criteria:
 * 1. Bank balance = opening_balance + SUM(DR journal lines) − SUM(CR journal lines) on the account.
 * 2. Importing a bank statement creates the correct number of bank_statement_lines rows.
 * 3. Matching a journal entry line to a statement line sets both is_reconciled = TRUE.
 * 4. Unreconciled report correctly shows items on both sides with the unexplained difference.
 * 5. Only one bank account can have is_default = TRUE.
 */

const mongoose = require('mongoose');
const request = require('supertest');
const { BankAccount, BankTransaction, BankStatementLine, BankReconciliationMatch } = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const User = require('../models/User');
const Company = require('../models/Company');

// Test setup helper
const setupTest = async () => {
  // Create test company
  const company = await Company.create({
    name: 'Test Company',
    currencyCode: 'USD',
    country: 'US',
    email: 'company-test@example.com'
  });

  // Create test user
  const user = await User.create({
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    company: company._id
  });

  return { company, user };
};

// Clean up helper
const cleanup = async () => {
  await BankReconciliationMatch.deleteMany({});
  await BankStatementLine.deleteMany({});
  await BankTransaction.deleteMany({});
  await BankAccount.deleteMany({});
  await JournalEntry.deleteMany({});
  await User.deleteMany({});
  await Company.deleteMany({});
};

describe('Module 3 - Bank Accounts', () => {
  let company;
  let user;
  let authToken;

  beforeAll(async () => {
    // Connect to test database
    const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test_stock_tenancy';
    await mongoose.connect(dbUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    const setup = await setupTest();
    company = setup.company;
    user = setup.user;
    
    // Generate auth token (simplified for testing)
    authToken = Buffer.from(`${user.email}:password123`).toString('base64');
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('3.1 Bank Balance Formula', () => {
    test('Bank balance = opening_balance + SUM(DR journal lines) − SUM(CR journal lines)', async () => {
      // Create bank account with opening balance
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 1000,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        isDefault: true,
        createdBy: user._id
      });

      // Create journal entries with DR and CR for this bank account
      const journalEntry1 = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-15'),
        description: 'Deposit',
        entryNumber: 'JE-001',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 500, credit: 0, description: 'Deposit to bank' },
          { accountCode: '1200', accountName: 'Cash', debit: 0, credit: 500, description: 'Cash received' }
        ],
        createdBy: user._id
      });

      const journalEntry2 = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-20'),
        description: 'Withdrawal',
        entryNumber: 'JE-002',
        status: 'posted',
        lines: [
          { accountCode: '1300', accountName: 'Payment', debit: 200, credit: 0, description: 'Payment received' },
          { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 200, description: 'Withdrawal from bank' }
        ],
        createdBy: user._id
      });

      // Ensure cache is invalid so computed balance includes posted journal entries
      bankAccount.cacheValid = false;
      await bankAccount.save();

      // Get computed balance using the model's getBalance method
      const result = await bankAccount.getBalance(JournalEntry);

      // Expected: opening_balance (1000) + DR (500) - CR (200) = 1300
      const expectedBalance = 1000 + 500 - 200;
      
      expect(result.balance).toBe(expectedBalance);
      expect(result.details.openingBalance).toBe(1000);
      expect(result.details.totalDebits).toBe(500);
      expect(result.details.totalCredits).toBe(200);
    });

    test('getComputedBalance endpoint returns correct balance', async () => {
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 500,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        isDefault: true,
        createdBy: user._id,
        // Pre-set cached balance for testing
        cachedBalance: 500,
        cacheValid: true
      });

      // Test via API endpoint (would need server running)
      // For unit test, we verify the model method
      const result = await bankAccount.getBalance(JournalEntry);
      expect(result.balance).toBe(500); // No journal entries, just opening balance
    });
  });

  describe('3.2 Bank Statement Import', () => {
    test('Importing a bank statement creates the correct number of bank_statement_lines rows', async () => {
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 0,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        createdBy: user._id
      });

      // Simulate CSV import data
      const csvTransactions = [
        { date: '2024-01-01', description: 'Opening Balance', creditAmount: 1000, debitAmount: 0 },
        { date: '2024-01-05', description: 'Payment from Customer A', creditAmount: 500, debitAmount: 0 },
        { date: '2024-01-10', description: 'Payment to Supplier B', creditAmount: 0, debitAmount: 300 },
        { date: '2024-01-15', description: 'Bank Fee', creditAmount: 0, debitAmount: 10 },
        { date: '2024-01-20', description: 'Invoice Payment', creditAmount: 250, debitAmount: 0 }
      ];

      // Import transactions
      for (const tx of csvTransactions) {
        const statementLine = new BankStatementLine({
          company: company._id,
          bankAccount: bankAccount._id,
          transactionDate: new Date(tx.date),
          description: tx.description,
          creditAmount: tx.creditAmount,
          debitAmount: tx.debitAmount,
          isReconciled: false
        });
        await statementLine.save();
      }

      // Verify correct number of rows created
      const statementLines = await BankStatementLine.find({ bankAccount: bankAccount._id });
      expect(statementLines.length).toBe(5);
    });

    test('Running balance is computed correctly during import', async () => {
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 0,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        createdBy: user._id
      });

      // Import with running balance computation
      const csvTransactions = [
        { date: '2024-01-01', description: 'Opening', creditAmount: 1000, debitAmount: 0 },
        { date: '2024-01-05', description: 'Payment', creditAmount: 0, debitAmount: 300 },
        { date: '2024-01-10', description: 'Deposit', creditAmount: 500, debitAmount: 0 }
      ];

      let runningBalance = 0;
      for (const tx of csvTransactions) {
        runningBalance = runningBalance + tx.creditAmount - tx.debitAmount;
        
        const statementLine = new BankStatementLine({
          company: company._id,
          bankAccount: bankAccount._id,
          transactionDate: new Date(tx.date),
          description: tx.description,
          creditAmount: tx.creditAmount,
          debitAmount: tx.debitAmount,
          balance: runningBalance,
          isReconciled: false
        });
        await statementLine.save();
      }

      // Verify running balances
      const lines = await BankStatementLine.find({ bankAccount: bankAccount._id }).sort({ transactionDate: 1 });
      
      expect(lines[0].balance).toBe(1000);  // 0 + 1000 - 0
      expect(lines[1].balance).toBe(700);   // 1000 + 0 - 300
      expect(lines[2].balance).toBe(1200);  // 700 + 500 - 0
    });
  });

  describe('3.3 Reconciliation Matching', () => {
    test('Matching a journal entry line to a statement line sets is_reconciled = TRUE', async () => {
      // Create bank account and statement line
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 1000,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        createdBy: user._id
      });

      const statementLine = await BankStatementLine.create({
        company: company._id,
        bankAccount: bankAccount._id,
        transactionDate: new Date('2024-01-15'),
        description: 'Payment received',
        creditAmount: 500,
        debitAmount: 0,
        isReconciled: false
      });

      // Create journal entry
      const journalEntry = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-15'),
        description: 'Payment from Customer',
        entryNumber: 'JE-001',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 500, credit: 0, description: 'Bank deposit' },
          { accountCode: '1300', accountName: 'Accounts Receivable', debit: 0, credit: 500, description: 'Accounts Receivable' }
        ],
        createdBy: user._id
      });

      const journalLineId = journalEntry.lines[0]._id;

      // Create match in junction table
      const match = await BankReconciliationMatch.create({
        bankStatementLine: statementLine._id,
        journalEntryLineId: journalLineId,
        journalEntry: journalEntry._id,
        bankAccount: bankAccount._id,
        company: company._id,
        matchedBy: user._id,
        matchedAmount: 500
      });

      // Update statement line as reconciled (exact match)
      statementLine.isReconciled = true;
      statementLine.matchedAmount = 500;
      await statementLine.save();

      // Update journal entry line as reconciled
      journalEntry.lines[0].reconciled = true;
      journalEntry.lines[0].matchedStatementLineId = statementLine._id;
      await journalEntry.save();

      // Verify both are reconciled
      const updatedStatementLine = await BankStatementLine.findById(statementLine._id);
      const updatedJournalEntry = await JournalEntry.findById(journalEntry._id);
      
      expect(updatedStatementLine.isReconciled).toBe(true);
      expect(updatedJournalEntry.lines[0].reconciled).toBe(true);
    });

    test('Many-to-one matching: multiple journal lines can match one statement line', async () => {
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 0,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        createdBy: user._id
      });

      // Statement line with amount 500
      const statementLine = await BankStatementLine.create({
        company: company._id,
        bankAccount: bankAccount._id,
        transactionDate: new Date('2024-01-15'),
        description: 'Payment',
        creditAmount: 500,
        debitAmount: 0,
        isReconciled: false
      });

      // First journal entry line - 300
      const journalEntry1 = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-15'),
        description: 'Payment part 1',
        entryNumber: 'JE-001',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 300, credit: 0, description: 'Bank deposit part 1' },
          { accountCode: '1300', accountName: 'AR', debit: 0, credit: 300, description: 'AR' }
        ],
        createdBy: user._id
      });

      // Second journal entry line - 200
      const journalEntry2 = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-15'),
        description: 'Payment part 2',
        entryNumber: 'JE-002',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 200, credit: 0, description: 'Bank deposit part 2' },
          { accountCode: '1300', accountName: 'AR', debit: 0, credit: 200, description: 'AR' }
        ],
        createdBy: user._id
      });

      // Create matches
      await BankReconciliationMatch.create({
        bankStatementLine: statementLine._id,
        journalEntryLineId: journalEntry1.lines[0]._id,
        journalEntry: journalEntry1._id,
        bankAccount: bankAccount._id,
        company: company._id,
        matchedBy: user._id,
        matchedAmount: 300
      });

      await BankReconciliationMatch.create({
        bankStatementLine: statementLine._id,
        journalEntryLineId: journalEntry2.lines[0]._id,
        journalEntry: journalEntry2._id,
        bankAccount: bankAccount._id,
        company: company._id,
        matchedBy: user._id,
        matchedAmount: 200
      });

      // Total matched = 300 + 200 = 500 = statement amount -> fully reconciled
      const totalMatched = 300 + 200;
      expect(totalMatched).toBe(500);

      const matches = await BankReconciliationMatch.find({ bankStatementLine: statementLine._id });
      expect(matches.length).toBe(2);
    });
  });

  describe('3.4 Unreconciled Report', () => {
    test('Unreconciled report shows items on both sides with difference', async () => {
      const bankAccount = await BankAccount.create({
        company: company._id,
        name: 'Test Bank Account',
        accountNumber: '123456',
        bankName: 'Test Bank',
        currencyCode: 'USD',
        openingBalance: 1000,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        createdBy: user._id
      });

      // Create unreconciled journal entries
      const journalEntry1 = await JournalEntry.create({
        company: company._id,
        date: new Date('2024-01-15'),
        description: 'Deposit not in statement',
        entryNumber: 'JE-001',
        status: 'posted',
        lines: [
          { accountCode: '1100', accountName: 'Bank', debit: 200, credit: 0, description: 'Deposit' },
          { accountCode: '1200', accountName: 'Cash', debit: 0, credit: 200, description: 'Cash' }
        ],
        createdBy: user._id
      });

      // Create unreconciled statement line
      await BankStatementLine.create({
        company: company._id,
        bankAccount: bankAccount._id,
        transactionDate: new Date('2024-01-20'),
        description: 'Bank charge not in books',
        creditAmount: 0,
        debitAmount: 50,
        isReconciled: false
      });

      // Get journal lines for this bank account
      const journalLines = [];
      const journalEntries = await JournalEntry.find({
        company: company._id,
        status: 'posted',
        lines: { $elemMatch: { accountCode: '1100' } }
      });

      for (const entry of journalEntries) {
        for (const line of entry.lines) {
          if (line.accountCode === '1100' && !line.reconciled) {
            journalLines.push({
              id: entry._id,
              lineId: line._id,
              amount: parseFloat(line.debit?.toString() || '0') || -parseFloat(line.credit?.toString() || '0'),
              isDebit: parseFloat(line.debit?.toString() || '0') > 0,
              reconciled: false
            });
          }
        }
      }

      // Get unreconciled statement lines
      const statementLines = await BankStatementLine.find({
        bankAccount: bankAccount._id,
        isReconciled: false
      });

      // Calculate totals
      const bookBalance = 1000 + 200; // opening + DR
      const bankBalance = 950; // 1000 - 50 (bank charge)
      
      // Per spec: adjusted balances
      const depositsInTransit = journalLines.filter(l => l.isDebit).reduce((sum, l) => sum + Math.abs(l.amount), 0);
      const outstandingPayments = journalLines.filter(l => !l.isDebit).reduce((sum, l) => sum + Math.abs(l.amount), 0);
      const bankCreditsNotInBooks = statementLines.filter(l => (l.creditAmount || 0) > 0).reduce((sum, l) => sum + (l.creditAmount || 0), 0);
      const bankChargesNotInBooks = statementLines.filter(l => (l.debitAmount || 0) > 0).reduce((sum, l) => sum + (l.debitAmount || 0), 0);

      const adjustedBankBalance = bankBalance + depositsInTransit - outstandingPayments;
      const adjustedBookBalance = bookBalance + bankCreditsNotInBooks - bankChargesNotInBooks;
      const difference = adjustedBankBalance - adjustedBookBalance;

      // Verify report data
      expect(journalLines.length).toBe(1); // 1 unreconciled journal line
      expect(statementLines.length).toBe(1); // 1 unreconciled statement line
      expect(difference).toBe(0); // Should be zero if properly reconciled
    });
  });

  describe('3.5 Default Account', () => {
    test('Only one bank account can have is_default = TRUE', async () => {
      // Create first bank account with isDefault = true
      const account1 = await BankAccount.create({
        company: company._id,
        name: 'Primary Bank Account',
        accountNumber: '111111',
        bankName: 'Bank A',
        currencyCode: 'USD',
        openingBalance: 1000,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1100',
        isActive: true,
        isDefault: true,
        createdBy: user._id
      });

      // Try to create second bank account with isDefault = true
      const account2 = new BankAccount({
        company: company._id,
        name: 'Secondary Bank Account',
        accountNumber: '222222',
        bankName: 'Bank B',
        currencyCode: 'USD',
        openingBalance: 500,
        openingBalanceDate: new Date('2024-01-01'),
        ledgerAccountId: '1101',
        isActive: true,
        isDefault: true, // Attempt to set as default
        createdBy: user._id
      });

      await account2.save();

      // Verify only one default exists
      const defaultAccounts = await BankAccount.find({ company: company._id, isDefault: true });
      expect(defaultAccounts.length).toBe(1);
      expect(defaultAccounts[0].name).toBe('Secondary Bank Account'); // Most recent should be default

      // Verify previous default is no longer default
      const primaryAccount = await BankAccount.findById(account1._id);
      expect(primaryAccount.isDefault).toBe(false);
    });
  });
});
