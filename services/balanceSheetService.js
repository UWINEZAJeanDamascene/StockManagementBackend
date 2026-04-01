const mongoose = require('mongoose');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');
const Company = require('../models/Company');
const PLStatementService = require('./plStatementService');

/**
 * Balance Sheet Service — IAS 1 Compliant Statement of Financial Position
 *
 * Structure (IAS 1 / IFRS):
 *   ASSETS
 *     Non-Current Assets
 *       Property, Plant & Equipment (net of accumulated depreciation)
 *       Other Non-Current Assets
 *     Current Assets
 *       Inventories
 *       Trade & Other Receivables
 *       Cash & Cash Equivalents
 *       Other Current Assets
 *     TOTAL ASSETS
 *
 *   EQUITY & LIABILITIES
 *     Equity
 *       Share Capital
 *       Retained Earnings (including current period P&L)
 *       Dividends Paid
 *     Non-Current Liabilities
 *       Long-Term Borrowings
 *     Current Liabilities
 *       Trade & Other Payables
 *       Short-Term Borrowings
 *       Tax Payables
 *       Other Current Liabilities
 *     TOTAL EQUITY & LIABILITIES
 *
 * Assets = Liabilities + Equity (must balance)
 */
class BalanceSheetService {

  /**
   * Generate Balance Sheet report
   * @param {string} companyId - Company ID
   * @param {object} options - { asOfDate, comparativeDate }
   */
  static async generate(companyId, { asOfDate, comparativeDate }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!asOfDate) throw new Error('AS_OF_DATE_REQUIRED');

    const company = await Company.findById(companyId).lean();

    const [currentPeriod, comparativePeriod] = await Promise.all([
      BalanceSheetService._buildPeriodData(companyId, asOfDate, company),
      comparativeDate
        ? BalanceSheetService._buildPeriodData(companyId, comparativeDate, company)
        : null
    ]);

    return {
      company_id: companyId,
      company_name: company?.name || '',
      as_of_date: asOfDate,
      comparative_date: comparativeDate || null,
      current: currentPeriod,
      comparative: comparativePeriod,
      generated_at: new Date()
    };
  }

  /**
   * Build balance sheet data for a specific date
   * @private
   */
  static async _buildPeriodData(companyId, asOfDate, company) {
    const dateTo = new Date(asOfDate);

    // Get all account balances up to asOfDate
    const accountBalances = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
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

    if (accountBalances.length === 0) {
      return BalanceSheetService._emptyPeriodData();
    }

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
    const nonCurrentAssetLines = [];
    const currentAssetLines = [];
    const equityLines = [];
    const nonCurrentLiabilityLines = [];
    const currentLiabilityLines = [];

    for (const bal of accountBalances) {
      const account = accountMap[bal._id];
      if (!account) continue;

      const dr = parseFloat(bal.total_dr?.toString() || '0');
      const cr = parseFloat(bal.total_cr?.toString() || '0');

      // Apply normal balance direction
      let amount = account.normal_balance === 'debit' ? dr - cr : cr - dr;

      // Dividends Paid is debit-normal equity — negate for balance sheet (reduces equity)
      if (account.subtype === 'dividends') {
        amount = -Math.abs(amount);
      }

      const line = {
        account_id: account._id,
        account_code: account.code,
        account_name: account.name,
        sub_type: account.subtype,
        amount: Math.round(amount * 100) / 100
      };

      const subtype = account.subtype || '';
      const type = account.type;

      // ── Classification Logic (IAS 1) ──────────────────────────────
      if (type === 'asset') {
        if (BalanceSheetService._isNonCurrentAsset(subtype)) {
          // Non-Current Assets: fixed, land
          nonCurrentAssetLines.push(line);
        } else if (BalanceSheetService._isContraAsset(subtype)) {
          // Contra Assets (Accumulated Depreciation) — show as negative under non-current
          line.amount = -Math.abs(line.amount);
          nonCurrentAssetLines.push(line);
        } else {
          // Current Assets: cash, current, inventory, prepaid, ar, vat_input
          currentAssetLines.push(line);
        }
      } else if (type === 'liability') {
        // VAT Input (2210) is liability type but debit-normal — it's a receivable, classify as current asset
        if (subtype === 'vat_input' && account.normal_balance === 'debit') {
          currentAssetLines.push(line);
        } else if (subtype === 'non_current') {
          // Non-Current Liabilities: long-term loans
          nonCurrentLiabilityLines.push(line);
        } else {
          // Current Liabilities: everything else (current, ap, tax payables, accruals)
          currentLiabilityLines.push(line);
        }
      } else if (type === 'equity') {
        equityLines.push(line);
      }
    }

    // Sort each section by account code
    const sortFn = (a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true });
    nonCurrentAssetLines.sort(sortFn);
    currentAssetLines.sort(sortFn);
    equityLines.sort(sortFn);
    nonCurrentLiabilityLines.sort(sortFn);
    currentLiabilityLines.sort(sortFn);

    // Compute current period net profit from P&L
    const fiscalYearStart = BalanceSheetService._getFiscalYearStart(
      asOfDate,
      company?.fiscal_year_start_month || 1
    );

    const plData = await PLStatementService._buildPeriodData(
      companyId,
      fiscalYearStart.toISOString().split('T')[0],
      asOfDate
    );
    const currentPeriodNetProfit = plData.net_profit;

    // Add current period net profit to retained earnings display
    const retainedEarningsLine = equityLines.find(l => l.sub_type === 'retained');
    if (retainedEarningsLine) {
      retainedEarningsLine.amount = Math.round(
        (retainedEarningsLine.amount + currentPeriodNetProfit) * 100
      ) / 100;
      retainedEarningsLine.includes_current_period_profit = true;
      retainedEarningsLine.current_period_net_profit = currentPeriodNetProfit;
    } else {
      // No retained earnings journal entries exist — create a synthetic line with P&L net profit
      equityLines.push({
        account_id: null,
        account_code: '3100',
        account_name: 'Retained Earnings',
        sub_type: 'retained',
        amount: Math.round(currentPeriodNetProfit * 100) / 100,
        includes_current_period_profit: true,
        current_period_net_profit: currentPeriodNetProfit
      });
      equityLines.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));
    }

    // Compute section totals
    const round = (n) => Math.round(n * 100) / 100;
    const sumLines = (lines) => round(lines.reduce((s, l) => s + l.amount, 0));

    const totalNonCurrentAssets = sumLines(nonCurrentAssetLines);
    const totalCurrentAssets = sumLines(currentAssetLines);
    const totalAssets = round(totalNonCurrentAssets + totalCurrentAssets);

    const totalEquity = sumLines(equityLines);
    const totalNonCurrentLiabilities = sumLines(nonCurrentLiabilityLines);
    const totalCurrentLiabilities = sumLines(currentLiabilityLines);
    const totalLiabilities = round(totalNonCurrentLiabilities + totalCurrentLiabilities);
    const totalEquityAndLiabilities = round(totalEquity + totalLiabilities);

    const difference = Math.abs(totalAssets - totalEquityAndLiabilities);
    const isBalanced = difference < 0.01;

    return {
      // Non-Current Assets
      non_current_assets: {
        lines: nonCurrentAssetLines,
        total: totalNonCurrentAssets
      },

      // Current Assets
      current_assets: {
        lines: currentAssetLines,
        total: totalCurrentAssets
      },

      // Total Assets
      total_assets: totalAssets,

      // Equity
      equity: {
        lines: equityLines,
        total: totalEquity
      },

      // Non-Current Liabilities
      non_current_liabilities: {
        lines: nonCurrentLiabilityLines,
        total: totalNonCurrentLiabilities
      },

      // Current Liabilities
      current_liabilities: {
        lines: currentLiabilityLines,
        total: totalCurrentLiabilities
      },

      // Total Liabilities
      total_liabilities: totalLiabilities,

      // Total Equity & Liabilities
      total_equity_and_liabilities: totalEquityAndLiabilities,

      // Balance check
      is_balanced: isBalanced,
      difference: round(difference),

      // P&L integration
      current_period_net_profit: round(currentPeriodNetProfit)
    };
  }

  /**
   * Check if asset subtype is non-current
   */
  static _isNonCurrentAsset(subtype) {
    return ['fixed', 'fixed_asset', 'non_current', 'land'].includes(subtype);
  }

  /**
   * Check if asset subtype is contra (accumulated depreciation)
   */
  static _isContraAsset(subtype) {
    return ['contra', 'contra_asset'].includes(subtype);
  }

  /**
   * Get fiscal year start date
   */
  static _getFiscalYearStart(asOfDate, fiscalYearStartMonth) {
    const date = new Date(asOfDate);
    const year = date.getMonth() + 1 >= fiscalYearStartMonth
      ? date.getFullYear()
      : date.getFullYear() - 1;
    return new Date(`${year}-${String(fiscalYearStartMonth).padStart(2, '0')}-01`);
  }

  /**
   * Return empty period data structure
   * @private
   */
  static _emptyPeriodData() {
    return {
      non_current_assets: { lines: [], total: 0 },
      current_assets: { lines: [], total: 0 },
      total_assets: 0,
      equity: { lines: [], total: 0 },
      non_current_liabilities: { lines: [], total: 0 },
      current_liabilities: { lines: [], total: 0 },
      total_liabilities: 0,
      total_equity_and_liabilities: 0,
      is_balanced: true,
      difference: 0,
      current_period_net_profit: 0
    };
  }
}

module.exports = BalanceSheetService;
