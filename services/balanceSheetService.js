const mongoose = require('mongoose');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');
const Company = require('../models/Company');
const PLStatementService = require('./plStatementService');

/**
 * Balance Sheet Service
 * 
 * Shows the financial position of the company at a specific date.
 * Uses embedded lines in JournalEntry (not separate JournalEntryLine collection)
 */
class BalanceSheetService {

  /**
   * Generate Balance Sheet report
   * @param {string} companyId - Company ID
   * @param {object} options - { asOfDate }
   */
  static async generate(companyId, { asOfDate }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!asOfDate) throw new Error('AS_OF_DATE_REQUIRED');

    // Balance sheet is cumulative — from beginning of time to asOfDate
    const dateFrom = new Date('1900-01-01');
    const dateTo = new Date(asOfDate);

    // Get all account balances up to asOfDate
    // Using embedded lines approach with $unwind
    const accountBalances = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          date: { $lte: dateTo }
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

    // Get all balance sheet accounts
    const accountCodes = accountBalances.map(b => b._id);
    const accounts = await ChartOfAccount.find({
      code: { $in: accountCodes },
      company: new mongoose.Types.ObjectId(companyId),
      type: { $in: ['asset', 'liability', 'equity'] }
    }).lean();

    const accountMap = {};
    for (const acc of accounts) {
      accountMap[acc.code] = acc;
    }

    // Build section arrays
    const currentAssets = [];
    const nonCurrentAssets = [];
    const currentLiabilities = [];
    const nonCurrentLiabilities = [];
    const equityLines = [];

    for (const bal of accountBalances) {
      const account = accountMap[bal._id];
      if (!account) continue;

      // Apply normal balance direction
      let amount = account.normal_balance === 'debit'
        ? (bal.total_dr || 0) - (bal.total_cr || 0)
        : (bal.total_cr || 0) - (bal.total_dr || 0);

      // Accumulated depreciation is a contra-asset — show as negative
      if (account.subtype === 'contra_asset') {
        amount = -Math.abs(amount);
      }

      const line = {
        account_id: account._id,
        account_code: account.code,
        account_name: account.name,
        sub_type: account.subtype,
        amount: Math.round(amount * 100) / 100
      };

      // Classify into sections based on sub_type
      if (account.type === 'asset') {
        const currentSubTypes = ['cash', 'ar', 'inventory', 'prepaid', 'contra_asset'];
        if (currentSubTypes.includes(account.subtype)) {
          currentAssets.push(line);
        } else {
          nonCurrentAssets.push(line);
        }
      } else if (account.type === 'liability') {
        const currentLiabSubTypes = ['ap', 'tax', 'accrual'];
        if (currentLiabSubTypes.includes(account.subtype)) {
          currentLiabilities.push(line);
        } else {
          nonCurrentLiabilities.push(line);
        }
      } else if (account.type === 'equity') {
        equityLines.push(line);
      }
    }

    // Sort each section by account code
    [currentAssets, nonCurrentAssets, currentLiabilities,
      nonCurrentLiabilities, equityLines].forEach(arr =>
      arr.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }))
    );

    // Compute current period net profit from P&L
    // Use fiscal year start to asOfDate
    const company = await Company.findById(companyId).lean();
    const fiscalYearStart = BalanceSheetService._getFiscalYearStart(
      asOfDate,
      company.fiscal_year_start_month || 1
    );

    const plData = await PLStatementService._buildPeriodData(
      companyId,
      fiscalYearStart.toISOString().split('T')[0],
      asOfDate
    );
    const currentPeriodNetProfit = plData.net_profit;

    // Add current period net profit to retained earnings display
    const retainedEarningsLine = equityLines.find(
      l => l.sub_type === 'retained'
    );
    if (retainedEarningsLine) {
      retainedEarningsLine.amount = Math.round(
        (retainedEarningsLine.amount + currentPeriodNetProfit) * 100
      ) / 100;
      retainedEarningsLine.includes_current_period_profit = true;
      retainedEarningsLine.current_period_net_profit = currentPeriodNetProfit;
    }

    // Compute section totals
    const totalCurrentAssets = currentAssets.reduce((s, l) => s + l.amount, 0);
    const totalNonCurrentAssets = nonCurrentAssets.reduce((s, l) => s + l.amount, 0);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
    const totalCurrentLiabilities = currentLiabilities.reduce((s, l) => s + l.amount, 0);
    const totalNonCurrentLiabilities = nonCurrentLiabilities.reduce((s, l) => s + l.amount, 0);
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;
    const totalEquity = equityLines.reduce((s, l) => s + l.amount, 0);
    const totalLiabilitiesPlusEquity = totalLiabilities + totalEquity;
    const difference = Math.abs(totalAssets - totalLiabilitiesPlusEquity);
    const isBalanced = difference < 0.01;

    return {
      company_id: companyId,
      as_of_date: asOfDate,
      assets: {
        current: {
          lines: currentAssets,
          total: Math.round(totalCurrentAssets * 100) / 100
        },
        non_current: {
          lines: nonCurrentAssets,
          total: Math.round(totalNonCurrentAssets * 100) / 100
        },
        total: Math.round(totalAssets * 100) / 100
      },
      liabilities: {
        current: {
          lines: currentLiabilities,
          total: Math.round(totalCurrentLiabilities * 100) / 100
        },
        non_current: {
          lines: nonCurrentLiabilities,
          total: Math.round(totalNonCurrentLiabilities * 100) / 100
        },
        total: Math.round(totalLiabilities * 100) / 100
      },
      equity: {
        lines: equityLines,
        total: Math.round(totalEquity * 100) / 100
      },
      total_liabilities_and_equity: Math.round(totalLiabilitiesPlusEquity * 100) / 100,
      is_balanced: isBalanced,
      difference: Math.round(difference * 100) / 100,
      current_period_net_profit: Math.round(currentPeriodNetProfit * 100) / 100,
      generated_at: new Date()
    };
  }

  static _getFiscalYearStart(asOfDate, fiscalYearStartMonth) {
    const date = new Date(asOfDate);
    const year = date.getMonth() + 1 >= fiscalYearStartMonth
      ? date.getFullYear()
      : date.getFullYear() - 1;
    return new Date(`${year}-${String(fiscalYearStartMonth).padStart(2, '0')}-01`);
  }
}

module.exports = BalanceSheetService;
