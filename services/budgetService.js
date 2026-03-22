const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const BudgetLine = require('../models/BudgetLine');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

class BudgetService {

  /**
   * Create a new budget
   */
  static async create(companyId, data, userId) {
    const budget = new Budget({
      company_id: companyId,
      name: data.name,
      fiscal_year: data.fiscal_year,
      status: 'draft',
      created_by: userId
    });

    return budget.save();
  }

  /**
   * Get all budgets for a company
   */
  static async findAll(companyId, filters = {}) {
    const query = { company_id: companyId };
    
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.fiscal_year) {
      query.fiscal_year = filters.fiscal_year;
    }

    return Budget.find(query).sort({ fiscal_year: -1, name: 1 });
  }

  /**
   * Get a single budget by ID
   */
  static async findById(companyId, budgetId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });
    
    if (!budget) {
      throw new Error('NOT_FOUND');
    }
    
    return budget;
  }

  /**
   * Update a budget
   */
  static async update(companyId, budgetId, data) {
    const budget = await Budget.findOneAndUpdate(
      { _id: budgetId, company_id: companyId },
      { $set: data },
      { new: true }
    );

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    return budget;
  }

  /**
   * Delete a budget (only if draft)
   */
  static async delete(companyId, budgetId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });
    
    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status !== 'draft') {
      throw new Error('BUDGET_NOT_DRAFT');
    }

    // Delete all budget lines
    await BudgetLine.deleteMany({ budget_id: budgetId, company_id: companyId });
    
    // Delete the budget
    await Budget.deleteOne({ _id: budgetId });
    
    return { deleted: true };
  }

  /**
   * Bulk upsert budget lines — replaces existing lines for the period
   */
  static async upsertLines(companyId, budgetId, lines, userId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status === 'locked') {
      throw new Error('BUDGET_LOCKED');
    }

    // Validate every account belongs to this company
    for (const line of lines) {
      const account = await ChartOfAccount.findOne({
        _id: line.account_id,
        company: companyId
      });
      
      if (!account) {
        throw new Error('ACCOUNT_NOT_FOUND');
      }
    }

    // Bulk upsert using MongoDB updateOne with upsert: true
    const ops = lines.map(line => ({
      updateOne: {
        filter: {
          company_id: companyId,
          budget_id: budgetId,
          account_id: line.account_id,
          period_month: line.period_month,
          period_year: line.period_year
        },
        update: {
          $set: {
            budgeted_amount: line.budgeted_amount,
            company_id: companyId,
            budget_id: budgetId,
            account_id: line.account_id,
            period_month: line.period_month,
            period_year: line.period_year
          }
        },
        upsert: true
      }
    }));

    await BudgetLine.bulkWrite(ops);
    return { upserted: lines.length };
  }

  /**
   * Get budget lines for a budget
   */
  static async getLines(companyId, budgetId, filters = {}) {
    const query = { company_id: companyId, budget_id: budgetId };
    
    if (filters.period_year) {
      query.period_year = filters.period_year;
    }
    if (filters.period_month) {
      query.period_month = filters.period_month;
    }

    return BudgetLine.find(query).populate('account_id');
  }

  /**
   * Approve a budget
   */
  static async approve(companyId, budgetId, userId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status !== 'draft') {
      throw new Error('BUDGET_NOT_DRAFT');
    }

    return Budget.findByIdAndUpdate(budgetId, {
      status: 'approved',
      approved_by: userId,
      approved_at: new Date()
    }, { new: true });
  }

  /**
   * Lock a budget
   */
  static async lock(companyId, budgetId, userId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status !== 'approved') {
      throw new Error('BUDGET_NOT_APPROVED');
    }

    return Budget.findByIdAndUpdate(budgetId, {
      status: 'locked',
      locked_at: new Date()
    }, { new: true });
  }

  // ── BUDGET VS ACTUAL VARIANCE REPORT ──────────────────────────────
  /**
   * Actual figures pulled live from journal — never stored
   */
  static async getVarianceReport(companyId, budgetId, { periodStart, periodEnd }) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // Get all budget lines for this budget scoped to company
    const budgetLines = await BudgetLine.find({
      company_id: companyId,
      budget_id: budgetId,
      period_year: {
        $gte: startYear,
        $lte: endYear
      }
    }).lean();

    if (!budgetLines.length) {
      return { budget_id: budgetId, lines: [], total_variance: 0 };
    }

    // Get unique account IDs from budget lines
    const accountIds = [...new Set(budgetLines.map(l => l.account_id.toString()))];

    // Get actual totals from journal for each account in period
    // scoped to this company only
    const actualTotals = await aggregateWithTimeout(JournalEntry, [
      { $unwind: '$lines' },
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          date: {
            $gte: startDate,
            $lte: endDate
          },
          'lines.accountCode': { $exists: true }
        }
      },
      {
        $lookup: {
          from: 'chartofaccounts',
          let: { accountCode: '$lines.accountCode' },
          pipeline: [
            { $match: { $expr: { $eq: ['$$accountCode', '$code'] }, company: new mongoose.Types.ObjectId(companyId) } },
            { $project: { _id: 1 } }
          ],
          as: 'account'
        }
      },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'account._id': { $in: accountIds.map(id => new mongoose.Types.ObjectId(id)) }
        }
      },
      {
        $group: {
          _id: '$account._id',
          total_dr: { $sum: '$lines.debit' },
          total_cr: { $sum: '$lines.credit' }
        }
      }
    ]);

    // Build lookup map for actuals
    const actualMap = {};
    for (const row of actualTotals) {
      actualMap[row._id.toString()] = row;
    }

    // Get account codes for reference
    const accountCodes = await ChartOfAccount.find({
      _id: { $in: accountIds.map(id => new mongoose.Types.ObjectId(id)) }
    }).select('_id code name type');

    const accountMap = {};
    for (const acc of accountCodes) {
      accountMap[acc._id.toString()] = acc;
    }

    // Merge budget lines with actuals
    const lines = budgetLines.map(budgetLine => {
      const account = accountMap[budgetLine.account_id.toString()];
      const actual = actualMap[budgetLine.account_id.toString()];
      
      const actualDr = actual?.total_dr ? Number(actual.total_dr.toString()) : 0;
      const actualCr = actual?.total_cr ? Number(actual.total_cr.toString()) : 0;
      
      // Determine normal balance from account type
      // Expense accounts (type === 'expense'): normal balance is DR
      // Revenue accounts (type === 'revenue' or 'income'): normal balance is CR
      // For simplicity, we use DR - CR (same as expense accounts)
      const actualAmount = actualDr - actualCr;
      
      const budgetedAmount = Number(budgetLine.budgeted_amount.toString());
      const variance = budgetedAmount - actualAmount;
      const variancePct = budgetedAmount !== 0
        ? (variance / budgetedAmount) * 100
        : 0;

      return {
        account_id: budgetLine.account_id,
        account_code: account?.code || '',
        account_name: account?.name || '',
        period_month: budgetLine.period_month,
        period_year: budgetLine.period_year,
        budgeted_amount: budgetedAmount,
        actual_amount: actualAmount,
        variance: variance,
        variance_pct: Math.round(variancePct * 100) / 100
      };
    });

    const totalVariance = lines.reduce((s, l) => s + l.variance, 0);

    return {
      company_id: companyId,
      budget_id: budgetId,
      budget_name: budget.name,
      fiscal_year: budget.fiscal_year,
      period_start: periodStart,
      period_end: periodEnd,
      lines,
      total_variance: totalVariance,
      computed_at: new Date()
    };
  }
}

module.exports = BudgetService;
