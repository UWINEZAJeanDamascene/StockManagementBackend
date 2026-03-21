/**
 * MODULE 7 - Opening Balances Acceptance Tests
 * 
 * Tests:
 * 1. Posts balanced journal entry with correct DR and CR lines
 * 2. Throws OPENING_BALANCES_UNBALANCED when DR does not equal CR
 * 3. Throws TRANSACTIONS_EXIST when other transactions already exist
 * 4. Marks setup step opening_balances as complete
 * 5. source_type is opening_balance on the journal entry
 * 6. Is idempotent — cannot import twice
 * 7. Preview returns correct totals without posting
 * 8. Scoped to company — accounts must belong to company
 * 9. Logs to audit trail
 */

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');

const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const Company = require('../models/Company');
const User = require('../models/User');
const AccountingPeriod = require('../models/AccountingPeriod');
const AuditLog = require('../models/AuditLog');

let authToken;
let testCompany;
let testUser;
let testAccounts = {};

jest.setTimeout(60000);

describe('OpeningBalanceService', () => {
  
  const cleanup = async () => {
    if (testCompany && testCompany._id) {
      await JournalEntry.deleteMany({ company: testCompany._id });
      // Don't delete accounts - they are created once in beforeAll and reused
      await AuditLog.deleteMany({ company_id: testCompany._id });
    }
  };

  beforeAll(async () => {
    jest.setTimeout(60000);
    const unique = Date.now();
    
    testCompany = await Company.create({
      name: 'Test Company for Opening Balances',
      email: `test${unique}@ob.com`,
      phone: '1234567890',
      address: { street: 'Test Address' },
      base_currency: 'USD',
      fiscal_year_start_month: 1,
      approvalStatus: 'approved',
      is_active: true,
      isActive: true
    });
    
    testUser = await User.create({
      name: 'Test User',
      email: `testuser${unique}@ob.com`,
      password: 'password123',
      company: testCompany._id,
      role: 'admin'
    });
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: `testuser${unique}@ob.com`,
        password: 'password123'
      });
    
    authToken = loginRes.body.access_token || loginRes.body.token;

    // Create accounting period for the test date
    const periods2024 = [
      { company_id: testCompany._id, name: 'Jan 2024', period_type: 'month', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-31'), fiscal_year: 2024, status: 'open' }
    ];
    await AccountingPeriod.insertMany(periods2024);

    // Create test accounts for opening balances
    // Note: 3100 is Retained Earnings (allowDirectPosting: false), use 3000 for Share Capital
    const accounts = [
      { code: '1100', name: 'Cash at Bank', type: 'asset', subtype: 'current', company: testCompany._id, allow_direct_posting: true },
      { code: '1200', name: 'Accounts Receivable', type: 'asset', subtype: 'current', company: testCompany._id, allow_direct_posting: true },
      { code: '1300', name: 'Inventory', type: 'asset', subtype: 'current', company: testCompany._id, allow_direct_posting: true },
      { code: '2100', name: 'Accounts Payable', type: 'liability', subtype: 'current', company: testCompany._id, allow_direct_posting: true },
      { code: '3000', name: 'Share Capital', type: 'equity', subtype: 'ownerequity', company: testCompany._id, allow_direct_posting: true }
    ];

    for (const acc of accounts) {
      const created = await ChartOfAccount.findOneAndUpdate(
        { code: acc.code, company: testCompany._id },
        acc,
        { upsert: true, new: true }
      );
      testAccounts[acc.code] = created;
    }
  }, 60000);

  beforeEach(async () => {
    await cleanup();
  }, 60000);

  afterAll(async () => {
    const keep = ['accountingperiods'];
    if (testCompany && testCompany._id) {
      await JournalEntry.deleteMany({ company: testCompany._id });
      if (!keep.includes('chartofaccounts')) {
        await ChartOfAccount.deleteMany({ company: testCompany._id });
      }
      if (!keep.includes('users')) {
        await User.deleteMany({ company: testCompany._id });
      }
      if (!keep.includes('companies')) {
        await Company.deleteMany({ _id: testCompany._id });
      }
    }
    
    try {
      await mongoose.connection.close();
    } catch (e) {
      console.warn('Error closing mongoose connection', e && e.message ? e.message : e);
    }

    try {
      const { redisClient } = require('../config/redis');
      if (redisClient) {
        if (typeof redisClient.quit === 'function') await redisClient.quit();
        else if (typeof redisClient.disconnect === 'function') await redisClient.disconnect();
        else if (typeof redisClient.close === 'function') await redisClient.close();
      }
    } catch (e) {
      // ignore
    }

    try {
      if (app && typeof app.shutdown === 'function') {
        await app.shutdown();
      }
    } catch (e) {
      console.warn('Error during app.shutdown', e && e.message ? e.message : e);
    }
  }, 60000);

  describe('Test 1: Posts balanced journal entry with correct DR and CR lines', () => {
    it('should create balanced opening balance journal entry', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['1200']._id, entry_type: 'debit', amount: 2500, description: 'AR balance' },
        { account_id: testAccounts['2100']._id, entry_type: 'credit', amount: 3200, description: 'AP balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 4300, description: 'Capital' }
      ];

      const res = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total_dr).toBe(7500);
      expect(res.body.data.total_cr).toBe(7500);
      expect(res.body.data.accounts_imported).toBe(4);

      // Verify journal entry was created
      const journalEntry = await JournalEntry.findOne({
        company: testCompany._id,
        sourceType: 'opening_balance'
      });

      expect(journalEntry).toBeDefined();
      expect(journalEntry.lines.length).toBe(4);
    });
  });

  describe('Test 2: Throws OPENING_BALANCES_UNBALANCED when DR does not equal CR', () => {
    it('should reject unbalanced opening balances', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['1200']._id, entry_type: 'debit', amount: 2500, description: 'AR balance' },
        { account_id: testAccounts['2100']._id, entry_type: 'credit', amount: 3000, description: 'AP balance' } // Only 3000, not 7500
      ];

      const res = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('OPENING_BALANCES_UNBALANCED');
    });
  });

  describe('Test 3: Throws TRANSACTIONS_EXIST when other transactions already exist', () => {
    it('should reject opening balances if transactions exist', async () => {
      // First create a regular journal entry
      await JournalEntry.create({
        company: testCompany._id,
        entryNumber: 'JE-TEST-001',
        date: new Date('2024-01-15'),
        description: 'Test transaction',
        sourceType: 'manual',
        lines: [
          { accountCode: '1100', accountName: 'Cash at Bank', description: 'Test', debit: 100, credit: 0 },
          { accountCode: '3000', accountName: 'Share Capital', description: 'Test', debit: 0, credit: 100 }
        ],
        totalDebit: 100,
        totalCredit: 100,
        status: 'posted',
        createdBy: testUser._id,
        postedBy: testUser._id
      });

      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      const res = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('TRANSACTIONS_EXIST');
    });
  });

  describe('Test 4: Marks setup step opening_balances as complete', () => {
    it('should mark opening_balances step as complete after import', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      const res = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(res.status).toBe(201);

      // Check company setup step
      const company = await Company.findById(testCompany._id);
      expect(company.setup_steps_completed.opening_balances).toBe(true);
    });
  });

  describe('Test 5: source_type is opening_balance on the journal entry', () => {
    it('should set source_type to opening_balance', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      const journalEntry = await JournalEntry.findOne({
        company: testCompany._id
      });

      expect(journalEntry.sourceType).toBe('opening_balance');
    });
  });

  describe('Test 6: Is idempotent — cannot import twice', () => {
    it('should not allow importing opening balances twice', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      // First import should succeed
      const firstRes = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(firstRes.status).toBe(201);

      // Second import should fail
      const secondRes = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toBe('OPENING_BALANCE_ALREADY_EXISTS');
    });
  });

  describe('Test 7: Preview returns correct totals without posting', () => {
    it('should return preview without creating journal entry', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['1200']._id, entry_type: 'debit', amount: 2500, description: 'AR balance' },
        { account_id: testAccounts['2100']._id, entry_type: 'credit', amount: 3200, description: 'AP balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 4300, description: 'Capital' }
      ];

      const res = await request(app)
        .post('/api/opening-balances/preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances
        });

      expect(res.status).toBe(200);
      expect(res.body.data.total_dr).toBe(7500);
      expect(res.body.data.total_cr).toBe(7500);
      expect(res.body.data.is_balanced).toBe(true);

      // Verify no journal entry was created
      const journalCount = await JournalEntry.countDocuments({
        company: testCompany._id,
        sourceType: 'opening_balance'
      });
      expect(journalCount).toBe(0);
    });
  });

  describe('Test 8: Scoped to company — accounts must belong to company', () => {
    it('should reject accounts from other companies', async () => {
      // Create another company with different accounts
      const otherCompany = await Company.create({
        name: 'Other Company',
        email: 'other@test.com',
        phone: '1111111111',
        address: { street: 'Other Address' },
        base_currency: 'USD',
        fiscal_year_start_month: 1,
        approvalStatus: 'approved',
        is_active: true,
        isActive: true
      });

      const otherAccount = await ChartOfAccount.create({
        code: '9999',
        name: 'Other Account',
        type: 'asset',
        subtype: 'current',
        company: otherCompany._id
      });

      const balances = [
        { account_id: otherAccount._id, entry_type: 'debit', amount: 5000, description: 'Other company account' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      const res = await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');

      // Cleanup
      await Company.findByIdAndDelete(otherCompany._id);
      await ChartOfAccount.findByIdAndDelete(otherAccount._id);
    });
  });

  describe('Test 9: Logs to audit trail', () => {
    it('should create audit log entry', async () => {
      const balances = [
        { account_id: testAccounts['1100']._id, entry_type: 'debit', amount: 5000, description: 'Bank balance' },
        { account_id: testAccounts['3000']._id, entry_type: 'credit', amount: 5000, description: 'Capital' }
      ];

      await request(app)
        .post('/api/opening-balances/import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asOfDate: '2024-01-01',
          balances: balances,
          userId: testUser._id.toString()
        });

      const auditLog = await AuditLog.findOne({
        company_id: testCompany._id,
        action: 'opening_balances.import'
      });

      expect(auditLog).toBeDefined();
      expect(auditLog.entity_type).toBe('journal_entry');
      expect(auditLog.changes.as_of_date).toBe('2024-01-01');
      expect(auditLog.changes.account_count).toBe(2);
    });
  });
});
