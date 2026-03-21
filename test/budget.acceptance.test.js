const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Budget = require('../models/Budget');
const BudgetLine = require('../models/BudgetLine');
const BudgetService = require('../services/budgetService');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

let mongoServer;
let companyA, companyB;
let userA, userB;
let accountA1, accountA2, accountB1;

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

  // Create chart of accounts for each company
  accountA1 = await ChartOfAccount.create({
    company: companyA._id,
    code: '6100',
    name: 'Operating Expenses',
    type: 'expense',
    subtype: 'operating',
    isActive: true
  });

  accountA2 = await ChartOfAccount.create({
    company: companyA._id,
    code: '4100',
    name: 'Revenue',
    type: 'revenue',
    subtype: 'operating',
    isActive: true
  });

  accountB1 = await ChartOfAccount.create({
    company: companyB._id,
    code: '6100',
    name: 'Operating Expenses',
    type: 'expense',
    subtype: 'operating',
    isActive: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Budget.deleteMany({});
  await BudgetLine.deleteMany({});
  await JournalEntry.deleteMany({});
});

describe('BudgetService', () => {

  describe('create()', () => {
    it('creates budget scoped to company with status draft', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      expect(budget.name).toBe('2025 Budget');
      expect(budget.fiscal_year).toBe(2025);
      expect(budget.status).toBe('draft');
      expect(String(budget.company_id)).toBe(String(companyA._id));
    });

    it('duplicate name + fiscal_year for same company throws', async () => {
      await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await expect(
        BudgetService.create(companyA._id, {
          name: '2025 Budget',
          fiscal_year: 2025
        }, userA._id)
      ).rejects.toThrow();
    });

    it('same name + fiscal_year in different companies is allowed', async () => {
      const budgetA = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      const budgetB = await BudgetService.create(companyB._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userB._id);

      expect(budgetA).toBeDefined();
      expect(budgetB).toBeDefined();
      expect(budgetA._id.toString()).not.toBe(budgetB._id.toString());
    });
  });

  describe('upsertLines()', () => {
    it('inserts new lines scoped to company', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      const result = await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 1,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      expect(result.upserted).toBe(1);

      const lines = await BudgetLine.find({ budget_id: budget._id });
      expect(lines.length).toBe(1);
      expect(Number(lines[0].budgeted_amount)).toBe(10000);
    });

    it('updates existing lines on second upsert', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 1,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      // Upsert again with different amount
      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 1,
          period_year: 2025,
          budgeted_amount: 15000
        }
      ], userA._id);

      const lines = await BudgetLine.find({ budget_id: budget._id });
      expect(lines.length).toBe(1);
      expect(Number(lines[0].budgeted_amount)).toBe(15000);
    });

    it('throws BUDGET_LOCKED when budget is locked', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      // Approve and lock
      await BudgetService.approve(companyA._id, budget._id, userA._id);
      await BudgetService.lock(companyA._id, budget._id, userA._id);

      await expect(
        BudgetService.upsertLines(companyA._id, budget._id, [
          {
            account_id: accountA1._id,
            period_month: 1,
            period_year: 2025,
            budgeted_amount: 10000
          }
        ], userA._id)
      ).rejects.toThrow('BUDGET_LOCKED');
    });

    it('account_id from different company throws ACCOUNT_NOT_FOUND', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      // accountB1 belongs to companyB, not companyA
      await expect(
        BudgetService.upsertLines(companyA._id, budget._id, [
          {
            account_id: accountB1._id,
            period_month: 1,
            period_year: 2025,
            budgeted_amount: 10000
          }
        ], userA._id)
      ).rejects.toThrow('ACCOUNT_NOT_FOUND');
    });
  });

  describe('approve() and lock()', () => {
    it('approve sets status to approved', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      const approved = await BudgetService.approve(companyA._id, budget._id, userA._id);

      expect(approved.status).toBe('approved');
      expect(approved.approved_by.toString()).toBe(userA._id.toString());
      expect(approved.approved_at).toBeDefined();
    });

    it('lock requires approved status — throws BUDGET_NOT_APPROVED on draft', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await expect(
        BudgetService.lock(companyA._id, budget._id, userA._id)
      ).rejects.toThrow('BUDGET_NOT_APPROVED');
    });

    it('upsertLines throws BUDGET_LOCKED after lock', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.approve(companyA._id, budget._id, userA._id);
      await BudgetService.lock(companyA._id, budget._id, userA._id);

      await expect(
        BudgetService.upsertLines(companyA._id, budget._id, [
          {
            account_id: accountA1._id,
            period_month: 1,
            period_year: 2025,
            budgeted_amount: 10000
          }
        ], userA._id)
      ).rejects.toThrow('BUDGET_LOCKED');
    });
  });

  describe('getVarianceReport()', () => {
    it('actual amounts are pulled from posted journal lines only', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      // Add budget line
      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 6,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      // Add posted journal entry for the same account (balanced with offset line)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2025-06-15'),
        description: 'Actual expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Operating Expenses', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'Accounts Receivable', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      const report = await BudgetService.getVarianceReport(companyA._id, budget._id, {
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31'
      });

      const line = report.lines.find(l => l.period_month === 6);
      expect(line.budgeted_amount).toBe(10000);
      expect(line.actual_amount).toBe(5000);
      expect(line.variance).toBe(5000);
    });

    it('draft and reversed journal entries are excluded from actuals', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 6,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      // Draft entry - should be excluded (balanced with offset)
      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-DRAFT',
        date: new Date('2025-06-15'),
        description: 'Draft',
        status: 'draft',
        lines: [
          { accountCode: '6100', accountName: 'Exp', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userA._id
      });

      const report = await BudgetService.getVarianceReport(companyA._id, budget._id, {
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31'
      });

      const line = report.lines.find(l => l.period_month === 6);
      expect(line.actual_amount).toBe(0); // Draft excluded
    });

    it('variance = budgeted - actual for each line', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 6,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      await JournalEntry.create({
        company: companyA._id,
        entryNumber: 'JE-001',
        date: new Date('2025-06-15'),
        description: 'Actual',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Exp', debit: 8000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 8000 }
        ],
        totalDebit: 8000,
        totalCredit: 8000,
        createdBy: userA._id
      });

      const report = await BudgetService.getVarianceReport(companyA._id, budget._id, {
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31'
      });

      const line = report.lines[0];
      expect(line.variance).toBe(2000); // 10000 - 8000
      expect(line.variance_pct).toBe(20); // 2000/10000 * 100
    });

    it('company A budget does not see company B journal entries in actuals', async () => {
      const budgetA = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.upsertLines(companyA._id, budgetA._id, [
        {
          account_id: accountA1._id,
          period_month: 6,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      // Company B journal entry on same account code (balanced)
      await JournalEntry.create({
        company: companyB._id,
        entryNumber: 'JE-B-001',
        date: new Date('2025-06-15'),
        description: 'Company B expense',
        status: 'posted',
        lines: [
          { accountCode: '6100', accountName: 'Exp', debit: 5000, credit: 0 },
          { accountCode: '1200', accountName: 'AR', debit: 0, credit: 5000 }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        createdBy: userB._id
      });

      const report = await BudgetService.getVarianceReport(companyA._id, budgetA._id, {
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31'
      });

      const line = report.lines[0];
      expect(line.actual_amount).toBe(0); // Company B entries excluded
    });

    it('returns zero actuals for accounts with no posted journal entries', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 6,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);

      const report = await BudgetService.getVarianceReport(companyA._id, budget._id, {
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31'
      });

      const line = report.lines[0];
      expect(line.budgeted_amount).toBe(10000);
      expect(line.actual_amount).toBe(0);
      expect(line.variance).toBe(10000);
    });

    it('throws NOT_FOUND when budget_id belongs to different company', async () => {
      const budgetA = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      await expect(
        BudgetService.getVarianceReport(companyB._id, budgetA._id, {
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31'
        })
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('CRITICAL — no journal entries posted by any budget operation', () => {
    it('create posts no journal entry', async () => {
      const before = await JournalEntry.countDocuments({ company: companyA._id });
      await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);
      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });

    it('upsertLines posts no journal entry', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      const before = await JournalEntry.countDocuments({ company: companyA._id });
      await BudgetService.upsertLines(companyA._id, budget._id, [
        {
          account_id: accountA1._id,
          period_month: 1,
          period_year: 2025,
          budgeted_amount: 10000
        }
      ], userA._id);
      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });

    it('approve posts no journal entry', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);

      const before = await JournalEntry.countDocuments({ company: companyA._id });
      await BudgetService.approve(companyA._id, budget._id, userA._id);
      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });

    it('lock posts no journal entry', async () => {
      const budget = await BudgetService.create(companyA._id, {
        name: '2025 Budget',
        fiscal_year: 2025
      }, userA._id);
      await BudgetService.approve(companyA._id, budget._id, userA._id);

      const before = await JournalEntry.countDocuments({ company: companyA._id });
      await BudgetService.lock(companyA._id, budget._id, userA._id);
      const after = await JournalEntry.countDocuments({ company: companyA._id });
      expect(after).toBe(before);
    });
  });
});
