const mongoose = require('mongoose');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');
const BalanceSheetService = require('./balanceSheetService');
const PLStatementService = require('./plStatementService');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

/**
 * Financial Ratios Dashboard Service
 * 
 * Computes 9 financial ratios live from the current state of the ledger.
 * No ratio is stored — they are always recomputed on demand.
 */
class FinancialRatiosService {

  /**
   * Compute all 9 financial ratios
   * @param {string} companyId - Company ID
   * @param {object} options - { asOfDate, dateFrom, dateTo }
   */
  static async compute(companyId, { asOfDate, dateFrom, dateTo }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!asOfDate) throw new Error('AS_OF_DATE_REQUIRED');
    if (!dateFrom || !dateTo) throw new Error('DATE_RANGE_REQUIRED');

    // Get balance sheet data — needed for liquidity and leverage ratios
    const bs = await BalanceSheetService.generate(companyId, { asOfDate });

    // Get P&L data for the period — needed for profitability ratios
    const pl = await PLStatementService.generate(companyId, { dateFrom, dateTo });
    const currentPeriod = pl.current || pl;

    // Extract specific balance sheet line values
    const currentAssets = bs.assets?.current?.total || 0;
    const totalAssets = bs.assets?.total || 0;
    const currentLiabilities = bs.liabilities?.current?.total || 0;
    const totalLiabilities = bs.liabilities?.total || 0;
    const totalEquity = bs.equity?.total || 0;

    // Inventory from balance sheet current assets
    const inventoryBalance = await FinancialRatiosService._getAccountTypeBalance(
      companyId, 'inventory', asOfDate
    );

    // Average inventory for turnover calculation
    // Uses balance at start and end of period
    const openingInventory = await FinancialRatiosService._getAccountTypeBalance(
      companyId, 'inventory', dateFrom
    );
    const avgInventory = (openingInventory + inventoryBalance) / 2;

    // AP balance for AP turnover
    const apBalance = await FinancialRatiosService._getAccountTypeBalance(
      companyId, 'ap', asOfDate
    );
    const openingAP = await FinancialRatiosService._getAccountTypeBalance(
      companyId, 'ap', dateFrom
    );
    const avgAP = (openingAP + apBalance) / 2;

    // Total purchases for AP turnover — from stock movements
    const totalPurchases = await FinancialRatiosService._getTotalPurchases(
      companyId, dateFrom, dateTo
    );

    // Values from P&L
    const revenue = currentPeriod.revenue?.total || 0;
    const cogs = currentPeriod.cogs?.total || 0;
    const grossProfit = currentPeriod.gross_profit || 0;
    const netProfit = currentPeriod.net_profit || 0;

    // ── COMPUTE ALL RATIOS ────────────────────────────────────────

    // 1. Current Ratio — liquidity
    const currentRatio = currentLiabilities > 0
      ? currentAssets / currentLiabilities
      : null;

    // 2. Quick Ratio — acid test liquidity (excludes inventory)
    const quickAssets = currentAssets - inventoryBalance;
    const quickRatio = currentLiabilities > 0
      ? quickAssets / currentLiabilities
      : null;

    // 3. Gross Margin — profitability
    const grossMarginPct = revenue > 0
      ? (grossProfit / revenue) * 100
      : null;

    // 4. Inventory Turnover — efficiency
    const inventoryTurnover = avgInventory > 0
      ? cogs / avgInventory
      : null;

    // 5. Days Inventory Outstanding (DIO)
    const daysInventory = inventoryTurnover > 0
      ? 365 / inventoryTurnover
      : null;

    // 6. AP Turnover — how fast the company pays suppliers
    const apTurnover = avgAP > 0
      ? totalPurchases / avgAP
      : null;

    // 7. Return on Assets (ROA)
    const returnOnAssets = totalAssets > 0
      ? (netProfit / totalAssets) * 100
      : null;

    // 8. Debt to Equity
    const debtToEquity = totalEquity > 0
      ? totalLiabilities / totalEquity
      : null;

    // 9. Net Profit Margin
    const netProfitMarginPct = revenue > 0
      ? (netProfit / revenue) * 100
      : null;

    return {
      company_id: companyId,
      as_of_date: asOfDate,
      date_from: dateFrom,
      date_to: dateTo,
      ratios: {
        current_ratio: {
          value: currentRatio !== null ? Math.round(currentRatio * 100) / 100 : null,
          formula: 'Current Assets ÷ Current Liabilities',
          inputs: { current_assets: currentAssets, current_liabilities: currentLiabilities },
          status: FinancialRatiosService._rateCurrentRatio(currentRatio)
        },
        quick_ratio: {
          value: quickRatio !== null ? Math.round(quickRatio * 100) / 100 : null,
          formula: '(Current Assets − Inventory) ÷ Current Liabilities',
          inputs: { quick_assets: quickAssets, current_liabilities: currentLiabilities },
          status: FinancialRatiosService._rateQuickRatio(quickRatio)
        },
        gross_margin_pct: {
          value: grossMarginPct !== null ? Math.round(grossMarginPct * 100) / 100 : null,
          formula: 'Gross Profit ÷ Revenue × 100',
          inputs: { gross_profit: grossProfit, revenue },
          status: FinancialRatiosService._rateGrossMargin(grossMarginPct)
        },
        inventory_turnover: {
          value: inventoryTurnover !== null ? Math.round(inventoryTurnover * 100) / 100 : null,
          formula: 'COGS ÷ Average Inventory',
          inputs: { cogs, avg_inventory: Math.round(avgInventory * 100) / 100 },
          status: FinancialRatiosService._rateInventoryTurnover(inventoryTurnover)
        },
        days_inventory_outstanding: {
          value: daysInventory !== null ? Math.round(daysInventory * 100) / 100 : null,
          formula: '365 ÷ Inventory Turnover',
          inputs: { inventory_turnover: inventoryTurnover },
          status: FinancialRatiosService._rateDIO(daysInventory)
        },
        ap_turnover: {
          value: apTurnover !== null ? Math.round(apTurnover * 100) / 100 : null,
          formula: 'Total Purchases ÷ Average AP',
          inputs: { total_purchases: totalPurchases, avg_ap: Math.round(avgAP * 100) / 100 },
          status: 'neutral'
        },
        return_on_assets: {
          value: returnOnAssets !== null ? Math.round(returnOnAssets * 100) / 100 : null,
          formula: 'Net Profit ÷ Total Assets × 100',
          inputs: { net_profit: netProfit, total_assets: totalAssets },
          status: FinancialRatiosService._rateROA(returnOnAssets)
        },
        debt_to_equity: {
          value: debtToEquity !== null ? Math.round(debtToEquity * 100) / 100 : null,
          formula: 'Total Liabilities ÷ Total Equity',
          inputs: { total_liabilities: totalLiabilities, total_equity: totalEquity },
          status: FinancialRatiosService._rateDebtToEquity(debtToEquity)
        },
        net_profit_margin_pct: {
          value: netProfitMarginPct !== null ? Math.round(netProfitMarginPct * 100) / 100 : null,
          formula: 'Net Profit ÷ Revenue × 100',
          inputs: { net_profit: netProfit, revenue },
          status: FinancialRatiosService._rateNetMargin(netProfitMarginPct)
        }
      },
      generated_at: new Date()
    };
  }

  // ── RATING HELPERS — status: 'good' | 'warning' | 'danger' | 'neutral' ──

  static _rateCurrentRatio(v) {
    if (v === null) return 'neutral';
    if (v >= 2) return 'good';
    if (v >= 1) return 'warning';
    return 'danger';
  }

  static _rateQuickRatio(v) {
    if (v === null) return 'neutral';
    if (v >= 1) return 'good';
    if (v >= 0.5) return 'warning';
    return 'danger';
  }

  static _rateGrossMargin(v) {
    if (v === null) return 'neutral';
    if (v >= 40) return 'good';
    if (v >= 20) return 'warning';
    return 'danger';
  }

  static _rateInventoryTurnover(v) {
    if (v === null) return 'neutral';
    if (v >= 6) return 'good';
    if (v >= 3) return 'warning';
    return 'danger';
  }

  static _rateDIO(v) {
    if (v === null) return 'neutral';
    if (v <= 60) return 'good';
    if (v <= 90) return 'warning';
    return 'danger';
  }

  static _rateROA(v) {
    if (v === null) return 'neutral';
    if (v >= 10) return 'good';
    if (v >= 5) return 'warning';
    return 'danger';
  }

  static _rateDebtToEquity(v) {
    if (v === null) return 'neutral';
    if (v <= 1) return 'good';
    if (v <= 2) return 'warning';
    return 'danger';
  }

  static _rateNetMargin(v) {
    if (v === null) return 'neutral';
    if (v >= 15) return 'good';
    if (v >= 5) return 'warning';
    return 'danger';
  }

  /**
   * Get balance by account sub_type
   */
  static async _getAccountTypeBalance(companyId, subType, asOfDate) {
    const accounts = await ChartOfAccount.find({
      company: new mongoose.Types.ObjectId(companyId),
      subtype: subType,
      isActive: true
    }).lean();

    let total = 0;
    for (const acc of accounts) {
      const bal = await FinancialRatiosService._getAccountBalance(
        companyId, acc.code,
        new Date('1900-01-01'),
        new Date(asOfDate)
      );
      total += bal;
    }
    return total;
  }

  /**
   * Get account balance from journal entries
   */
  static async _getAccountBalance(companyId, accountCode, dateFrom, dateTo) {
    const result = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          date: { $gte: dateFrom, $lte: new Date(dateTo) }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': accountCode
        }
      },
      {
        $group: {
          _id: null,
          total_dr: { $sum: '$lines.debit' },
          total_cr: { $sum: '$lines.credit' }
        }
      }
    ]);

    const dr = result[0]?.total_dr || 0;
    const cr = result[0]?.total_cr || 0;
    
    // Determine if this is an asset (dr balance) or liability/equity/revenue (cr balance)
    const account = await ChartOfAccount.findOne({
      company: new mongoose.Types.ObjectId(companyId),
      code: accountCode
    }).lean();

    if (account && ['asset', 'expense'].includes(account.type)) {
      return dr - cr;
    }
    return cr - dr;
  }

  /**
   * Get total purchases from journal entries with source_type = 'purchase'
   */
  static async _getTotalPurchases(companyId, dateFrom, dateTo) {
    // Total purchases = SUM of DR on inventory accounts from purchase source_type
    const result = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          sourceType: 'purchase',
          date: {
            $gte: new Date(dateFrom),
            $lte: new Date(dateTo)
          }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.debit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          total_dr: { $sum: '$lines.debit' }
        }
      }
    ]);
    return result[0]?.total_dr || 0;
  }
}

module.exports = FinancialRatiosService;
