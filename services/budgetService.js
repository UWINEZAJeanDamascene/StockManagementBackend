const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const BudgetLine = require('../models/BudgetLine');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const Notification = require('../models/Notification');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

const BUDGET_OVERRUN_THRESHOLD = 0.9; // 90% utilized = warning

class BudgetService {

  // ── CREATE ───────────────────────────────────────────────────────────
  static async create(companyId, data, userId) {
    const budgetData = {
      company_id: companyId,
      name: data.name,
      description: data.description || '',
      type: data.type || 'expense',
      fiscal_year: data.fiscal_year,
      status: 'draft',
      created_by: userId,
      department: data.department || null,
      notes: data.notes || '',
      periodType: data.periodType || 'yearly'
    };

    if (data.periodStart) budgetData.periodStart = new Date(data.periodStart);
    if (data.periodEnd) budgetData.periodEnd = new Date(data.periodEnd);
    if (data.amount != null) budgetData.amount = data.amount;

    const budget = new Budget(budgetData);
    const saved = await budget.save();

    // If items are provided inline, create budget lines
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      await BudgetService.upsertLines(companyId, saved._id, data.items, userId);
    }

    return saved;
  }

  // ── FIND ALL (with pagination) ───────────────────────────────────────
  static async findAll(companyId, filters = {}) {
    const query = { company_id: companyId };

    if (filters.status) query.status = filters.status;
    if (filters.fiscal_year) query.fiscal_year = Number(filters.fiscal_year);
    if (filters.type) query.type = filters.type;
    if (filters.department) query.department = filters.department;
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } }
      ];
    }
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) query.periodStart = { $gte: new Date(filters.startDate) };
      if (filters.endDate) {
        query.periodEnd = query.periodEnd || {};
        query.periodEnd.$lte = new Date(filters.endDate);
      }
    }

    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit) || 20));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Budget.find(query).sort({ fiscal_year: -1, name: 1 }).skip(skip).limit(limit).lean(),
      Budget.countDocuments(query)
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // ── FIND BY ID ───────────────────────────────────────────────────────
  static async findById(companyId, budgetId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    return budget;
  }

  // ── UPDATE ───────────────────────────────────────────────────────────
  static async update(companyId, budgetId, data) {
    // Only allow updating safe fields
    const allowed = ['name', 'description', 'type', 'department', 'notes', 'amount',
      'periodStart', 'periodEnd', 'periodType', 'status'];
    const updateData = {};
    for (const key of allowed) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (updateData.periodStart) updateData.periodStart = new Date(updateData.periodStart);
    if (updateData.periodEnd) updateData.periodEnd = new Date(updateData.periodEnd);

    const budget = await Budget.findOneAndUpdate(
      { _id: budgetId, company_id: companyId },
      { $set: updateData },
      { new: true }
    );

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    // If items are provided, upsert lines
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      await BudgetService.upsertLines(companyId, budgetId, data.items);
    }

    return budget;
  }

  // ── DELETE ───────────────────────────────────────────────────────────
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

  // ── UPSERT LINES ─────────────────────────────────────────────────────
  static async upsertLines(companyId, budgetId, lines, userId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status === 'locked' || budget.status === 'closed') {
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
            period_year: line.period_year,
            category: line.category || '',
            notes: line.notes || ''
          }
        },
        upsert: true
      }
    }));

    await BudgetLine.bulkWrite(ops);
    return { upserted: lines.length };
  }

  // ── GET LINES ────────────────────────────────────────────────────────
  static async getLines(companyId, budgetId, filters = {}) {
    const query = { company_id: companyId, budget_id: budgetId };

    if (filters.period_year) query.period_year = filters.period_year;
    if (filters.period_month) query.period_month = filters.period_month;

    return BudgetLine.find(query).populate('account_id');
  }

  // ── APPROVE ──────────────────────────────────────────────────────────
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

  // ── REJECT ───────────────────────────────────────────────────────────
  static async reject(companyId, budgetId, userId, reason = '') {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status !== 'draft' && budget.status !== 'approved') {
      throw new Error('BUDGET_CANNOT_REJECT');
    }

    return Budget.findByIdAndUpdate(budgetId, {
      status: 'cancelled',
      rejected_by: userId,
      rejected_at: new Date(),
      rejectionReason: reason
    }, { new: true });
  }

  // ── LOCK ─────────────────────────────────────────────────────────────
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

  // ── CLOSE ────────────────────────────────────────────────────────────
  static async close(companyId, budgetId, userId, notes = '') {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    if (budget.status === 'closed') {
      throw new Error('BUDGET_ALREADY_CLOSED');
    }

    if (budget.status === 'draft') {
      throw new Error('BUDGET_NOT_APPROVED');
    }

    return Budget.findByIdAndUpdate(budgetId, {
      status: 'closed',
      closed_by: userId,
      closed_at: new Date(),
      closeNotes: notes
    }, { new: true });
  }

  // ── CLONE ────────────────────────────────────────────────────────────
  static async clone(companyId, budgetId, userId, { newPeriodStart, newPeriodEnd, newName }) {
    const source = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!source) {
      throw new Error('NOT_FOUND');
    }

    const cloneName = newName || `${source.name} (Copy)`;

    const newBudget = new Budget({
      company_id: companyId,
      name: cloneName,
      description: source.description,
      type: source.type,
      fiscal_year: source.fiscal_year,
      periodStart: newPeriodStart ? new Date(newPeriodStart) : source.periodStart,
      periodEnd: newPeriodEnd ? new Date(newPeriodEnd) : source.periodEnd,
      periodType: source.periodType,
      department: source.department,
      notes: source.notes,
      amount: source.amount,
      status: 'draft',
      created_by: userId
    });

    const saved = await newBudget.save();

    // Clone all budget lines
    const sourceLines = await BudgetLine.find({
      company_id: companyId,
      budget_id: budgetId
    }).lean();

    if (sourceLines.length > 0) {
      const clonedLines = sourceLines.map(line => ({
        company_id: companyId,
        budget_id: saved._id,
        account_id: line.account_id,
        category: line.category,
        period_month: line.period_month,
        period_year: line.period_year,
        budgeted_amount: line.budgeted_amount,
        notes: line.notes
      }));

      await BudgetLine.insertMany(clonedLines);
    }

    return saved;
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────
  static async getSummary(companyId) {
    const budgets = await Budget.find({
      company_id: companyId,
      status: { $in: ['approved', 'locked'] }
    }).lean();

    const summaries = [];
    let totalBudgeted = 0;
    let totalActual = 0;
    let totalVariance = 0;
    let onTrack = 0;
    let exceeded = 0;

    for (const budget of budgets) {
      const lines = await BudgetLine.find({
        company_id: companyId,
        budget_id: budget._id
      }).lean();

      const budgetedAmount = lines.reduce((sum, l) => sum + Number(l.budgeted_amount.toString()), 0);

      // Get actual from journal entries
      const periodStart = budget.periodStart || new Date(budget.fiscal_year, 0, 1);
      const periodEnd = budget.periodEnd || new Date(budget.fiscal_year, 11, 31, 23, 59, 59);

      const accountIds = [...new Set(lines.map(l => l.account_id.toString()))];

      let actualAmount = 0;
      if (accountIds.length > 0) {
        const actualTotals = await aggregateWithTimeout(JournalEntry, [
          { $unwind: '$lines' },
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              status: 'posted',
              reversed: { $ne: true },
              date: { $gte: periodStart, $lte: periodEnd },
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
          { $match: { 'account._id': { $in: accountIds.map(id => new mongoose.Types.ObjectId(id)) } } },
          {
            $group: {
              _id: '$account._id',
              total_dr: { $sum: '$lines.debit' },
              total_cr: { $sum: '$lines.credit' }
            }
          }
        ]);

        actualAmount = actualTotals.reduce((sum, row) => {
          const dr = row.total_dr ? Number(row.total_dr.toString()) : 0;
          const cr = row.total_cr ? Number(row.total_cr.toString()) : 0;
          return sum + (dr - cr);
        }, 0);
      }

      const variance = budgetedAmount - actualAmount;
      const variancePercent = budgetedAmount !== 0 ? (variance / budgetedAmount) * 100 : 0;
      const utilization = budgetedAmount !== 0 ? (actualAmount / budgetedAmount) * 100 : 0;
      const isOnTrack = utilization <= 100;

      if (isOnTrack) onTrack++;
      else exceeded++;

      totalBudgeted += budgetedAmount;
      totalActual += actualAmount;
      totalVariance += variance;

      summaries.push({
        _id: budget._id,
        budgetId: budget._id,
        name: budget.name,
        type: budget.type,
        budgetedAmount: Math.round(budgetedAmount * 100) / 100,
        actualAmount: Math.round(actualAmount * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        variancePercent: Math.round(variancePercent * 100) / 100,
        utilization: Math.round(utilization * 100) / 100,
        isOnTrack
      });
    }

    // Count pending items
    const [pendingApprovals, draftBudgets] = await Promise.all([
      Budget.countDocuments({ company_id: companyId, status: 'draft' }),
      Budget.countDocuments({ company_id: companyId, status: 'draft' })
    ]);

    return {
      budgets: summaries,
      totals: {
        totalBudgeted: Math.round(totalBudgeted * 100) / 100,
        totalActual: Math.round(totalActual * 100) / 100,
        totalVariance: Math.round(totalVariance * 100) / 100
      },
      status: {
        onTrack,
        exceeded,
        total: budgets.length
      },
      pendingApprovals,
      draftBudgets
    };
  }

  // ── COMPARE ALL BUDGETS ──────────────────────────────────────────────
  static async getAllComparisons(companyId, filters = {}) {
    const query = { company_id: companyId };

    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;

    const budgets = await Budget.find(query).lean();
    const comparisons = [];

    let totalBudgeted = 0;
    let totalActual = 0;
    let activeBudgets = 0;

    for (const budget of budgets) {
      const lines = await BudgetLine.find({
        company_id: companyId,
        budget_id: budget._id
      }).lean();

      const budgetedAmount = lines.reduce((sum, l) => sum + Number(l.budgeted_amount.toString()), 0);

      const periodStart = filters.periodStart
        ? new Date(filters.periodStart)
        : (budget.periodStart || new Date(budget.fiscal_year, 0, 1));
      const periodEnd = filters.periodEnd
        ? new Date(filters.periodEnd)
        : (budget.periodEnd || new Date(budget.fiscal_year, 11, 31, 23, 59, 59));

      const accountIds = [...new Set(lines.map(l => l.account_id.toString()))];

      let actualAmount = 0;
      if (accountIds.length > 0) {
        const actualTotals = await aggregateWithTimeout(JournalEntry, [
          { $unwind: '$lines' },
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              status: 'posted',
              reversed: { $ne: true },
              date: { $gte: periodStart, $lte: periodEnd },
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
          { $match: { 'account._id': { $in: accountIds.map(id => new mongoose.Types.ObjectId(id)) } } },
          {
            $group: {
              _id: '$account._id',
              total_dr: { $sum: '$lines.debit' },
              total_cr: { $sum: '$lines.credit' }
            }
          }
        ]);

        actualAmount = actualTotals.reduce((sum, row) => {
          const dr = row.total_dr ? Number(row.total_dr.toString()) : 0;
          const cr = row.total_cr ? Number(row.total_cr.toString()) : 0;
          return sum + (dr - cr);
        }, 0);
      }

      const variance = budgetedAmount - actualAmount;
      const variancePercent = budgetedAmount !== 0 ? (variance / budgetedAmount) * 100 : 0;
      const utilizationPercent = budgetedAmount !== 0 ? (actualAmount / budgetedAmount) * 100 : 0;

      if (['approved', 'locked'].includes(budget.status)) {
        activeBudgets++;
        totalBudgeted += budgetedAmount;
        totalActual += actualAmount;
      }

      comparisons.push({
        _id: budget._id,
        budgetId: budget._id,
        name: budget.name,
        type: budget.type,
        status: budget.status,
        periodStart: budget.periodStart,
        periodEnd: budget.periodEnd,
        budgetedAmount: Math.round(budgetedAmount * 100) / 100,
        actualAmount: Math.round(actualAmount * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        variancePercent: Math.round(variancePercent * 100) / 100,
        utilizationPercent: Math.round(utilizationPercent * 100) / 100
      });
    }

    return {
      data: comparisons,
      summary: {
        totalBudgets: budgets.length,
        activeBudgets,
        totalBudgeted: Math.round(totalBudgeted * 100) / 100,
        totalActual: Math.round(totalActual * 100) / 100,
        averageUtilization: totalBudgeted > 0
          ? Math.round((totalActual / totalBudgeted) * 100 * 100) / 100
          : 0
      }
    };
  }

  // ── VARIANCE REPORT (Budget vs Actual) ───────────────────────────────
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

      // Determine over/under budget status
      const status = actualAmount > budgetedAmount ? 'over_budget' : 'under_budget';

      return {
        account_id: budgetLine.account_id,
        account_code: account?.code || '',
        account_name: account?.name || '',
        period_month: budgetLine.period_month,
        period_year: budgetLine.period_year,
        budgeted_amount: budgetedAmount,
        actual_amount: actualAmount,
        variance: variance,
        variance_pct: Math.round(variancePct * 100) / 100,
        status
      };
    });

    const totalBudgeted = lines.reduce((s, l) => s + l.budgeted_amount, 0);
    const totalActual = lines.reduce((s, l) => s + l.actual_amount, 0);
    const totalVariance = lines.reduce((s, l) => s + l.variance, 0);

    const result = {
      company_id: companyId,
      budget_id: budgetId,
      budget_name: budget.name,
      budget_type: budget.type,
      fiscal_year: budget.fiscal_year,
      period_start: periodStart,
      period_end: periodEnd,
      lines,
      total_budgeted: Math.round(totalBudgeted * 100) / 100,
      total_actual: Math.round(totalActual * 100) / 100,
      total_variance: Math.round(totalVariance * 100) / 100,
      utilization_pct: totalBudgeted > 0
        ? Math.round((totalActual / totalBudgeted) * 100 * 100) / 100
        : 0,
      computed_at: new Date()
    };

    // Check for budget overruns and send notifications asynchronously
    BudgetService._checkAndNotifyOverruns(companyId, budget, lines).catch(err => {
      console.error('Budget overrun notification failed:', err.message);
    });

    return result;
  }

  // ── COMPARE SINGLE BUDGET ────────────────────────────────────────────
  static async getComparison(companyId, budgetId) {
    const budget = await Budget.findOne({ _id: budgetId, company_id: companyId });

    if (!budget) {
      throw new Error('NOT_FOUND');
    }

    const periodStart = budget.periodStart || new Date(budget.fiscal_year, 0, 1);
    const periodEnd = budget.periodEnd || new Date(budget.fiscal_year, 11, 31, 23, 59, 59);

    const report = await BudgetService.getVarianceReport(companyId, budgetId, {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    });

    return report;
  }

  // ── FORECAST: REVENUE ────────────────────────────────────────────────
  static async getRevenueForecast(companyId, months = 6) {
    const now = new Date();
    const lookbackMonths = Math.max(months * 2, 12);
    const lookbackStart = new Date(now.getFullYear(), now.getMonth() - lookbackMonths, 1);

    // Get monthly revenue from journal entries (posted, non-reversed)
    const historical = await aggregateWithTimeout(JournalEntry, [
      { $unwind: '$lines' },
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          date: { $gte: lookbackStart, $lte: now },
          'lines.accountCode': { $exists: true }
        }
      },
      {
        $lookup: {
          from: 'chartofaccounts',
          let: { accountCode: '$lines.accountCode' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$$accountCode', '$code'] },
                company: new mongoose.Types.ObjectId(companyId),
                type: 'revenue'
              }
            },
            { $project: { _id: 1 } }
          ],
          as: 'account'
        }
      },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' } },
          revenue: {
            $sum: { $subtract: ['$lines.credit', '$lines.debit'] }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const monthlyData = historical.map(h => ({
      year: h._id.year,
      month: h._id.month,
      revenue: Math.round(Number(h.revenue.toString()) * 100) / 100,
      count: h.count
    }));

    // Simple linear regression for forecasting
    const forecast = BudgetService._linearForecast(monthlyData, 'revenue', months);

    const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
    const avgRevenue = monthlyData.length > 0 ? totalRevenue / monthlyData.length : 0;
    const trend = monthlyData.length >= 2
      ? (monthlyData[monthlyData.length - 1].revenue - monthlyData[0].revenue) / monthlyData.length
      : 0;

    return {
      historical: monthlyData,
      forecast,
      summary: {
        averageMonthlyRevenue: Math.round(avgRevenue * 100) / 100,
        totalProjected: Math.round(forecast.reduce((s, f) => s + f.projectedRevenue, 0) * 100) / 100,
        trend: Math.round(trend * 100) / 100,
        trendDirection: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
        dataPoints: monthlyData.length
      }
    };
  }

  // ── FORECAST: EXPENSE ────────────────────────────────────────────────
  static async getExpenseForecast(companyId, months = 6) {
    const now = new Date();
    const lookbackMonths = Math.max(months * 2, 12);
    const lookbackStart = new Date(now.getFullYear(), now.getMonth() - lookbackMonths, 1);

    // Get monthly expenses from journal entries (posted, non-reversed)
    const historical = await aggregateWithTimeout(JournalEntry, [
      { $unwind: '$lines' },
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          date: { $gte: lookbackStart, $lte: now },
          'lines.accountCode': { $exists: true }
        }
      },
      {
        $lookup: {
          from: 'chartofaccounts',
          let: { accountCode: '$lines.accountCode' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$$accountCode', '$code'] },
                company: new mongoose.Types.ObjectId(companyId),
                type: { $in: ['expense', 'cogs'] }
              }
            },
            { $project: { _id: 1 } }
          ],
          as: 'account'
        }
      },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' } },
          expense: {
            $sum: { $subtract: ['$lines.debit', '$lines.credit'] }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const monthlyData = historical.map(h => ({
      year: h._id.year,
      month: h._id.month,
      expense: Math.round(Number(h.expense.toString()) * 100) / 100,
      count: h.count
    }));

    const forecast = BudgetService._linearForecast(monthlyData, 'expense', months);

    const totalExpense = monthlyData.reduce((s, m) => s + m.expense, 0);
    const avgExpense = monthlyData.length > 0 ? totalExpense / monthlyData.length : 0;
    const trend = monthlyData.length >= 2
      ? (monthlyData[monthlyData.length - 1].expense - monthlyData[0].expense) / monthlyData.length
      : 0;

    return {
      historical: monthlyData,
      forecast,
      summary: {
        averageMonthlyExpense: Math.round(avgExpense * 100) / 100,
        totalProjected: Math.round(forecast.reduce((s, f) => s + f.projectedExpense, 0) * 100) / 100,
        trend: Math.round(trend * 100) / 100,
        trendDirection: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
        dataPoints: monthlyData.length
      }
    };
  }

  // ── FORECAST: CASH FLOW ──────────────────────────────────────────────
  static async getCashFlowForecast(companyId, months = 6) {
    const [revenueForecast, expenseForecast] = await Promise.all([
      BudgetService.getRevenueForecast(companyId, months),
      BudgetService.getExpenseForecast(companyId, months)
    ]);

    // Build combined forecast
    const forecast = [];
    for (let i = 0; i < months; i++) {
      const rev = revenueForecast.forecast[i];
      const exp = expenseForecast.forecast[i];
      if (!rev || !exp) continue;

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

      const projectedRevenue = rev.projectedRevenue || 0;
      const projectedExpense = exp.projectedExpense || 0;
      const netCashFlow = projectedRevenue - projectedExpense;
      const previousCumulative = i > 0 ? forecast[i - 1].cumulativeCashFlow : 0;

      forecast.push({
        year: rev.year,
        month: rev.month,
        monthName: monthNames[rev.month - 1] || '',
        projectedRevenue,
        projectedExpense,
        netCashFlow: Math.round(netCashFlow * 100) / 100,
        cumulativeCashFlow: Math.round((previousCumulative + netCashFlow) * 100) / 100
      });
    }

    // Current position: sum of receivables and payables
    const receivables = await aggregateWithTimeout(JournalEntry, [
      { $unwind: '$lines' },
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          'lines.accountCode': { $in: ['1300'] } // Accounts Receivable
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } }
        }
      }
    ]);

    const payables = await aggregateWithTimeout(JournalEntry, [
      { $unwind: '$lines' },
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          'lines.accountCode': { $in: ['2000'] } // Accounts Payable
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $subtract: ['$lines.credit', '$lines.debit'] } }
        }
      }
    ]);

    const receivablesTotal = receivables.length > 0 ? Number(receivables[0].total.toString()) : 0;
    const payablesTotal = payables.length > 0 ? Number(payables[0].total.toString()) : 0;

    const avgRevenue = revenueForecast.summary.averageMonthlyRevenue;
    const avgExpense = expenseForecast.summary.averageMonthlyExpense;

    return {
      currentPosition: {
        receivables: Math.round(receivablesTotal * 100) / 100,
        payables: Math.round(payablesTotal * 100) / 100,
        netPosition: Math.round((receivablesTotal - payablesTotal) * 100) / 100
      },
      historicalNetFlow: revenueForecast.historical.map((rev, i) => {
        const exp = expenseForecast.historical[i];
        return {
          year: rev.year,
          month: rev.month,
          revenue: rev.revenue,
          expense: exp ? exp.expense : 0,
          netFlow: Math.round((rev.revenue - (exp ? exp.expense : 0)) * 100) / 100
        };
      }),
      forecast,
      summary: {
        averageMonthlyRevenue: avgRevenue,
        averageMonthlyExpense: avgExpense,
        averageNetCashFlow: Math.round((avgRevenue - avgExpense) * 100) / 100,
        projectedTotalRevenue: Math.round(forecast.reduce((s, f) => s + f.projectedRevenue, 0) * 100) / 100,
        projectedTotalExpense: Math.round(forecast.reduce((s, f) => s + f.projectedExpense, 0) * 100) / 100,
        projectedNetCashFlow: Math.round(forecast.reduce((s, f) => s + f.netCashFlow, 0) * 100) / 100,
        revenueTrend: revenueForecast.summary.trend,
        expenseTrend: expenseForecast.summary.trend,
        dataPoints: revenueForecast.summary.dataPoints
      }
    };
  }

  // ── PRIVATE: LINEAR REGRESSION FORECAST ──────────────────────────────
  static _linearForecast(monthlyData, valueKey, forecastMonths) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    if (monthlyData.length < 2) {
      // Not enough data for regression, use last known value or 0
      const lastValue = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1][valueKey] : 0;
      const now = new Date();
      const result = [];
      for (let i = 1; i <= forecastMonths; i++) {
        const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
        result.push({
          year: forecastDate.getFullYear(),
          month: forecastDate.getMonth() + 1,
          monthName: monthNames[forecastDate.getMonth()],
          [`projected${valueKey.charAt(0).toUpperCase() + valueKey.slice(1)}`]: Math.round(lastValue * 100) / 100,
          confidence: 'low',
          trend: null
        });
      }
      return result;
    }

    // Simple linear regression: y = mx + b
    const n = monthlyData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = monthlyData[i][valueKey];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const b = (sumY - m * sumX) / n;

    const lastKnown = monthlyData[n - 1];
    const lastDate = new Date(lastKnown.year, lastKnown.month - 1, 1);

    const result = [];
    for (let i = 1; i <= forecastMonths; i++) {
      const x = n - 1 + i;
      const projectedValue = Math.max(0, m * x + b);
      const forecastDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + i, 1);

      // Confidence based on data points and R²
      const confidence = n >= 12 ? 'high' : n >= 6 ? 'medium' : 'low';

      result.push({
        year: forecastDate.getFullYear(),
        month: forecastDate.getMonth() + 1,
        monthName: monthNames[forecastDate.getMonth()],
        [`projected${valueKey.charAt(0).toUpperCase() + valueKey.slice(1)}`]: Math.round(projectedValue * 100) / 100,
        confidence,
        trend: m > 0 ? 'up' : m < 0 ? 'down' : 'stable'
      });
    }

    return result;
  }

  // ── PRIVATE: CHECK AND NOTIFY OVERRUNS ───────────────────────────────
  static async _checkAndNotifyOverruns(companyId, budget, lines) {
    try {
      const overBudgetLines = lines.filter(l => l.status === 'over_budget');

      if (overBudgetLines.length === 0) {
        // Also check near-threshold (>= 90% utilization)
        const nearThreshold = lines.filter(l => {
          return l.budgeted_amount > 0 &&
            (l.actual_amount / l.budgeted_amount) >= BUDGET_OVERRUN_THRESHOLD &&
            l.status === 'under_budget';
        });

        if (nearThreshold.length === 0) return;

        // Send warning notification
        await Notification.createNotification({
          company: companyId,
          user: budget.created_by,
          type: 'alert',
          title: 'Budget Warning: Near Limit',
          message: `Budget "${budget.name}" has ${nearThreshold.length} account(s) at or above ${BUDGET_OVERRUN_THRESHOLD * 100}% utilization.`,
          severity: 'warning',
          link: `/budgets/${budget._id}`,
          metadata: {
            budgetId: budget._id,
            budgetName: budget.name,
            type: 'budget_near_limit',
            accounts: nearThreshold.map(l => ({
              account_name: l.account_name,
              utilization: l.budgeted_amount > 0
                ? Math.round((l.actual_amount / l.budgeted_amount) * 100)
                : 0
            }))
          }
        });
        return;
      }

      // Over budget — critical notification
      const totalOverrun = overBudgetLines.reduce((s, l) => s + l.variance, 0);

      await Notification.createNotification({
        company: companyId,
        user: budget.created_by,
        type: 'alert',
        title: 'Budget Overrun Detected',
        message: `Budget "${budget.name}" has ${overBudgetLines.length} account(s) over budget by ${Math.abs(totalOverrun).toFixed(2)}.`,
        severity: 'critical',
        link: `/budgets/${budget._id}`,
        metadata: {
          budgetId: budget._id,
          budgetName: budget.name,
          type: 'budget_overrun',
          overBudgetCount: overBudgetLines.length,
          totalOverrun: Math.round(totalOverrun * 100) / 100,
          accounts: overBudgetLines.map(l => ({
            account_code: l.account_code,
            account_name: l.account_name,
            budgeted: l.budgeted_amount,
            actual: l.actual_amount,
            overrun: Math.abs(l.variance)
          }))
        }
      });

    } catch (err) {
      console.error('_checkAndNotifyOverruns error:', err.message);
    }
  }
}

module.exports = BudgetService;
