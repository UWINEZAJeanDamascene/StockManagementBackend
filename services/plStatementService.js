const mongoose = require('mongoose');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

/**
 * P&L Statement Service
 * 
 * Shows revenue earned and expenses incurred in a period, arriving at
 * gross profit, operating profit, and net profit.
 * 
 * Uses embedded lines in JournalEntry (not separate JournalEntryLine collection)
 */
class PLStatementService {

  /**
   * Generate P&L Statement report
   * @param {string} companyId - Company ID
   * @param {object} options - { dateFrom, dateTo, comparativeDateFrom, comparativeDateTo }
   */
  static async generate(companyId, { dateFrom, dateTo, comparativeDateFrom, comparativeDateTo }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!dateFrom || !dateTo) throw new Error('DATE_RANGE_REQUIRED');

    const [currentPeriod, comparativePeriod] = await Promise.all([
      PLStatementService._buildPeriodData(companyId, dateFrom, dateTo),
      comparativeDateFrom && comparativeDateTo
        ? PLStatementService._buildPeriodData(companyId, comparativeDateFrom, comparativeDateTo)
        : null
    ]);

    return {
      company_id: companyId,
      date_from: dateFrom,
      date_to: dateTo,
      current: currentPeriod,
      comparative: comparativePeriod,
      generated_at: new Date()
    };
  }

  /**
   * Build period data (revenue, COGS, expenses, calculations)
   * @private
   */
  static async _buildPeriodData(companyId, dateFrom, dateTo) {
    // Get all revenue and expense account balances in one aggregation
    // Using embedded lines approach with $unwind
    const accountBalances = await JournalEntry.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          date: {
            $gte: new Date(dateFrom),
            $lte: new Date(dateTo)
          }
        }
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          total_dr: { $sum: '$lines.debit' },
          total_cr: { $sum: '$lines.credit' }
        }
      }
    ]);

    if (accountBalances.length === 0) {
      return PLStatementService._emptyPeriodData();
    }

    // Get account details for all accounts with activity
    const accountCodes = accountBalances.map(b => b._id);
    const accounts = await ChartOfAccount.find({
      code: { $in: accountCodes },
      company: new mongoose.Types.ObjectId(companyId),
      type: { $in: ['revenue', 'expense'] }
    }).lean();

    const accountMap = {};
    for (const acc of accounts) {
      accountMap[acc.code] = acc;
    }

    // Separate into revenue and expense buckets
    const revenueLines = [];
    const cogsLines = [];
    const expenseLines = [];

    for (const bal of accountBalances) {
      const account = accountMap[bal._id];
      if (!account) continue;

      // Apply normal balance direction
      const amount = account.normal_balance === 'credit'
        ? (bal.total_cr || 0) - (bal.total_dr || 0)  // revenue: CR - DR
        : (bal.total_dr || 0) - (bal.total_cr || 0);  // expense: DR - CR

      const line = {
        account_id: account._id,
        account_code: account.code,
        account_name: account.name,
        amount: Math.round(amount * 100) / 100
      };

      if (account.type === 'revenue') {
        revenueLines.push(line);
      } else if (account.subtype === 'cogs' || account.subtype === 'inv_adj') {
        cogsLines.push(line);
      } else {
        expenseLines.push(line);
      }
    }

    // Sort each section by account code
    revenueLines.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));
    cogsLines.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));
    expenseLines.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));

    // Compute section totals
    const totalRevenue = revenueLines.reduce((s, l) => s + l.amount, 0);
    const totalCOGS = cogsLines.reduce((s, l) => s + l.amount, 0);
    const grossProfit = totalRevenue - totalCOGS;
    const totalOpex = expenseLines.reduce((s, l) => s + l.amount, 0);
    const netProfit = grossProfit - totalOpex;
    const grossMarginPct = totalRevenue > 0
      ? (grossProfit / totalRevenue) * 100 : 0;
    const netMarginPct = totalRevenue > 0
      ? (netProfit / totalRevenue) * 100 : 0;

    return {
      revenue: {
        lines: revenueLines,
        total: Math.round(totalRevenue * 100) / 100
      },
      cogs: {
        lines: cogsLines,
        total: Math.round(totalCOGS * 100) / 100
      },
      gross_profit: Math.round(grossProfit * 100) / 100,
      gross_margin_pct: Math.round(grossMarginPct * 100) / 100,
      expenses: {
        lines: expenseLines,
        total: Math.round(totalOpex * 100) / 100
      },
      net_profit: Math.round(netProfit * 100) / 100,
      net_margin_pct: Math.round(netMarginPct * 100) / 100,
      is_profit: netProfit >= 0
    };
  }

  /**
   * Return empty period data structure
   * @private
   */
  static _emptyPeriodData() {
    return {
      revenue: {
        lines: [],
        total: 0
      },
      cogs: {
        lines: [],
        total: 0
      },
      gross_profit: 0,
      gross_margin_pct: 0,
      expenses: {
        lines: [],
        total: 0
      },
      net_profit: 0,
      net_margin_pct: 0,
      is_profit: true
    };
  }
}

module.exports = PLStatementService;
