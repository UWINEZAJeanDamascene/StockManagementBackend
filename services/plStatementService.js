const mongoose = require('mongoose');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

/**
 * P&L Statement Service — IAS 1 Compliant Income Statement Format
 *
 * Structure (IAS 1 / IFRS):
 *   1.  Revenue
 *   2.  Cost of Sales (COGS)
 *   3.  Gross Profit (= Revenue - COGS)
 *   4.  Other Income
 *   5.  Distribution Costs
 *   6.  Administrative Expenses
 *   7.  Other Expenses
 *   8.  Operating Profit / EBIT (= GP + Other Income - Distribution - Admin - Other)
 *   9.  Finance Costs
 *  10.  Share of Profit of Associates/JV (placeholder)
 *  11.  Profit Before Tax (= EBIT - Finance Costs + Share of Associates)
 *  12.  Tax Expense (income tax, with effective tax rate)
 *  13.  Profit for the Period from Continuing Operations (= PBT - Tax)
 *  14.  Profit/(Loss) from Discontinued Operations (net of tax)
 *  15.  Profit for the Period (= Continuing + Discontinued)
 *  16.  Other Comprehensive Income (OCI) items
 *  17.  Total Comprehensive Income (= Profit + OCI)
 *  18.  Profit attributable to: Owners / Non-controlling Interests
 *  19.  Earnings Per Share (Basic & Diluted)
 *
 * Also computes:
 *   - EBITDA (= EBIT + Depreciation + Amortisation)
 *   - Margin percentages (gross, operating, net)
 *   - Effective tax rate
 *
 * Uses embedded lines in JournalEntry.
 * All amounts computed from posted journal entries for the given period.
 */
class PLStatementService {

  /**
   * Generate P&L Statement report
   * @param {string} companyId
   * @param {object} options — { dateFrom, dateTo, comparativeDateFrom, comparativeDateTo }
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
   * Build period data — full IAS 1 compliant P&L with all sections.
   * @private
   */
  static async _buildPeriodData(companyId, dateFrom, dateTo) {
    // ── Step 1: Aggregate all journal entry lines by account code ────
    const accountBalances = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
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

    // ── Step 2: Load account details for classification ──────────────
    const accountCodes = accountBalances.map(b => b._id);
    const accounts = await ChartOfAccount.find({
      code: { $in: accountCodes },
      company: new mongoose.Types.ObjectId(companyId),
      type: { $in: ['revenue', 'expense', 'cogs'] }
    }).lean();

    const accountMap = {};
    for (const acc of accounts) {
      accountMap[acc.code] = acc;
    }

    // ── Step 3: Classify each account into IAS 1 P&L sections ───────
    const revenueLines = [];             // Sales Revenue (4000), Sales Returns (4100)
    const cogsLines = [];                // COGS (5000), Purchases (5100), Freight In (5110), etc.
    const distributionCostLines = [];    // Transport & Delivery (5700), Marketing (5850)
    const adminExpenseLines = [];        // Salaries (5400), Rent (5500), Utilities (5600), etc.
    const otherExpenseLines = [];        // Bad Debt (5250), Other Expenses (6100)
    const otherIncomeLines = [];         // Other Income (4200), Interest Income (4300), Gain on Disposal (4250)
    const financeCostLines = [];         // Interest Expense (6000), Bank Charges (6200)
    const depreciationLines = [];        // Depreciation (5800) — tracked separately for EBITDA
    const taxLines = [];                 // Corporate Tax (6400)
    const nonOperatingExpenseLines = []; // Loss on Asset Disposal (6050)

    for (const bal of accountBalances) {
      const account = accountMap[bal._id];
      if (!account) continue;

      const dr = bal.total_dr || 0;
      const cr = bal.total_cr || 0;

      // Amount based on normal balance direction
      const amount = account.normal_balance === 'credit'
        ? cr - dr   // credit-normal: CR - DR (negative for contra accounts like Sales Returns)
        : dr - cr;  // debit-normal: DR - CR

      const line = {
        account_id: account._id,
        account_code: account.code,
        account_name: account.name,
        amount: Math.round(amount * 100) / 100
      };

      const subtype = account.subtype || '';
      const type = account.type;
      const code = account.code;

      // ── Classification Logic (IAS 1) ──────────────────────────────
      if (type === 'revenue') {
        if (subtype === 'non_operating') {
          // Other Income: 4200, 4300, 4250, 4400
          otherIncomeLines.push(line);
        } else {
          // Operating Revenue: 4000, 4100 (contra — will be negative)
          revenueLines.push(line);
        }
      } else if (type === 'cogs') {
        // COGS: 5000, 5100, 5110, 5150, 5200 (contra), 5300
        cogsLines.push(line);
      } else if (type === 'expense') {
        if (subtype === 'financial') {
          // Finance Costs: 6000 (Interest Expense), 6200 (Bank Charges)
          financeCostLines.push(line);
        } else if (subtype === 'tax') {
          // Tax Expense: 6400 (Corporate Tax)
          taxLines.push(line);
        } else if (subtype === 'non_operating') {
          // Non-operating expense (Loss on Disposal) → Other Comprehensive Income negative
          nonOperatingExpenseLines.push(line);
        } else if (code === '5800') {
          // Depreciation — tracked separately for EBITDA calculation
          depreciationLines.push(line);
          adminExpenseLines.push(line);
        } else if (subtype === 'operating') {
          // Classify operating expenses into distribution vs admin
          if (code === '5700' || code === '5850') {
            // Distribution Costs: Transport & Delivery, Marketing & Advertising
            distributionCostLines.push(line);
          } else if (code === '5250' || code === '6100') {
            // Other Expenses: Bad Debt Expense, Other Expenses
            otherExpenseLines.push(line);
          } else {
            // Administrative Expenses: Salaries, Rent, Utilities, Payroll, etc.
            adminExpenseLines.push(line);
          }
        } else if (subtype === 'rssb_employer_cost') {
          // RSSB Employer Cost → Administrative Expenses
          adminExpenseLines.push(line);
        } else {
          // Default: Administrative Expenses
          adminExpenseLines.push(line);
        }
      }
    }

    // ── Step 4: Sort each section by account code ───────────────────
    const sortFn = (a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true });
    revenueLines.sort(sortFn);
    cogsLines.sort(sortFn);
    distributionCostLines.sort(sortFn);
    adminExpenseLines.sort(sortFn);
    otherExpenseLines.sort(sortFn);
    otherIncomeLines.sort(sortFn);
    financeCostLines.sort(sortFn);
    depreciationLines.sort(sortFn);
    taxLines.sort(sortFn);
    nonOperatingExpenseLines.sort(sortFn);

    // ── Step 5: Compute section totals ──────────────────────────────
    const round = (n) => Math.round(n * 100) / 100;
    const sumLines = (lines) => round(lines.reduce((s, l) => s + l.amount, 0));

    const totalRevenue = sumLines(revenueLines);
    const totalCOGS = sumLines(cogsLines);
    const grossProfit = round(totalRevenue - totalCOGS);

    const totalOtherIncome = sumLines(otherIncomeLines);
    const totalDistributionCosts = sumLines(distributionCostLines);
    const totalAdminExpenses = sumLines(adminExpenseLines);
    const totalOtherExpenses = sumLines(otherExpenseLines);

    const operatingProfit = round(
      grossProfit + totalOtherIncome - totalDistributionCosts - totalAdminExpenses - totalOtherExpenses
    );

    const totalFinanceCosts = sumLines(financeCostLines);
    const totalDepreciation = sumLines(depreciationLines);
    const ebitda = round(operatingProfit + totalDepreciation);

    const shareOfAssociates = 0; // placeholder for equity method investments

    const profitBeforeTax = round(operatingProfit - totalFinanceCosts + shareOfAssociates);

    // Corporate income tax: use journal entries if present, otherwise auto-compute at 30% of PBT
    const CORPORATE_TAX_RATE = 0.30;
    let totalTax = sumLines(taxLines);
    let computedTax = false;
    if (totalTax === 0 && profitBeforeTax > 0) {
      totalTax = round(profitBeforeTax * CORPORATE_TAX_RATE);
      computedTax = true;
    }

    const profitAfterTax = round(profitBeforeTax - totalTax);
    const effectiveTaxRate = profitBeforeTax > 0
      ? round((totalTax / profitBeforeTax) * 100 * 100) / 100
      : 0;

    // Discontinued operations (placeholder — no data unless journal entries exist)
    const totalDiscontinuedOps = 0;

    const profitForPeriod = round(profitAfterTax + totalDiscontinuedOps);

    // Other Comprehensive Income (OCI)
    // Items that bypass P&L: revaluation surplus, foreign currency translation, etc.
    // These come from journal entries with specific OCI account codes (if configured)
    // For now, compute from non-operating items that represent OCI
    const totalOCI = sumLines(nonOperatingExpenseLines);

    const totalComprehensiveIncome = round(profitForPeriod + totalOCI);

    // Non-controlling interests (placeholder — for group reporting)
    const nciShare = 0;
    const ownersShare = round(totalComprehensiveIncome - nciShare);
    const profitAttributableToOwners = round(profitForPeriod - nciShare);

    // Earnings Per Share (placeholder — requires share count from company settings)
    const weightedAvgShares = 0; // Would come from company settings
    const basicEPS = weightedAvgShares > 0 ? round(profitAttributableToOwners / weightedAvgShares) : null;
    const dilutedEPS = basicEPS; // Same unless dilutive instruments exist

    // ── Step 6: Compute margin percentages ──────────────────────────
    const pct = (numerator, denominator) =>
      denominator > 0 ? round((numerator / denominator) * 100 * 100) / 100 : 0;

    const grossMarginPct = pct(grossProfit, totalRevenue);
    const operatingMarginPct = pct(operatingProfit, totalRevenue);
    const netMarginPct = pct(profitForPeriod, totalRevenue);
    const ebitdaMarginPct = pct(ebitda, totalRevenue);

    return {
      // Section 1: Revenue
      revenue: {
        lines: revenueLines,
        total: totalRevenue
      },

      // Section 2: Cost of Sales (COGS)
      cogs: {
        lines: cogsLines,
        total: totalCOGS
      },

      // Section 3: Gross Profit
      gross_profit: grossProfit,
      gross_margin_pct: grossMarginPct,

      // Section 4: Other Income
      other_income: {
        lines: otherIncomeLines,
        total: totalOtherIncome
      },

      // Section 5: Distribution Costs
      distribution_costs: {
        lines: distributionCostLines,
        total: totalDistributionCosts
      },

      // Section 6: Administrative Expenses
      administrative_expenses: {
        lines: adminExpenseLines,
        total: totalAdminExpenses
      },

      // Section 7: Other Expenses
      other_expenses: {
        lines: otherExpenseLines,
        total: totalOtherExpenses
      },

      // Section 8: Operating Profit (EBIT)
      operating_profit: operatingProfit,
      operating_margin_pct: operatingMarginPct,

      // EBITDA
      ebitda: ebitda,
      ebitda_margin_pct: ebitdaMarginPct,
      depreciation_and_amortisation: totalDepreciation,

      // Section 9: Finance Costs
      finance_costs: {
        lines: financeCostLines,
        total: totalFinanceCosts
      },

      // Section 10: Share of Profit of Associates/JV
      share_of_associates: shareOfAssociates,

      // Section 11: Profit Before Tax
      profit_before_tax: profitBeforeTax,

      // Section 12: Tax Expense
      tax: {
        lines: taxLines,
        total: totalTax
      },
      corporate_tax_rate: CORPORATE_TAX_RATE,
      effective_tax_rate: effectiveTaxRate,
      computed_tax: computedTax,

      // Section 13: Profit After Tax (from continuing operations)
      profit_after_tax: profitAfterTax,

      // Section 14: Discontinued Operations
      discontinued_operations: {
        total: totalDiscontinuedOps
      },

      // Section 15: Profit for the Period
      profit_for_period: profitForPeriod,

      // Section 16: Other Comprehensive Income
      other_comprehensive_income: {
        lines: nonOperatingExpenseLines,
        total: totalOCI
      },

      // Section 17: Total Comprehensive Income
      total_comprehensive_income: totalComprehensiveIncome,

      // Section 18: Profit Attributable To
      profit_attributable_to_owners: profitAttributableToOwners,
      profit_attributable_to_nci: nciShare,
      comprehensive_income_attributable_to_owners: ownersShare,
      comprehensive_income_attributable_to_nci: nciShare,

      // Section 19: Earnings Per Share
      earnings_per_share: {
        weighted_avg_shares: weightedAvgShares,
        basic_eps: basicEPS,
        diluted_eps: dilutedEPS
      },

      // Convenience aliases
      net_profit: profitForPeriod,
      net_margin_pct: netMarginPct,
      is_profit: profitForPeriod >= 0,

      // Legacy fields for backward compatibility
      operating_expenses: {
        lines: [...distributionCostLines, ...adminExpenseLines, ...otherExpenseLines],
        total: round(totalDistributionCosts + totalAdminExpenses + totalOtherExpenses)
      },
      expenses: {
        lines: [...distributionCostLines, ...adminExpenseLines, ...otherExpenseLines, ...financeCostLines, ...taxLines],
        total: round(totalDistributionCosts + totalAdminExpenses + totalOtherExpenses + totalFinanceCosts + totalTax)
      }
    };
  }

  /**
   * Return empty period data structure (all sections present with zero values).
   * @private
   */
  static _emptyPeriodData() {
    return {
      revenue: { lines: [], total: 0 },
      cogs: { lines: [], total: 0 },
      gross_profit: 0,
      gross_margin_pct: 0,
      other_income: { lines: [], total: 0 },
      distribution_costs: { lines: [], total: 0 },
      administrative_expenses: { lines: [], total: 0 },
      other_expenses: { lines: [], total: 0 },
      operating_profit: 0,
      operating_margin_pct: 0,
      ebitda: 0,
      ebitda_margin_pct: 0,
      depreciation_and_amortisation: 0,
      finance_costs: { lines: [], total: 0 },
      share_of_associates: 0,
      profit_before_tax: 0,
      tax: { lines: [], total: 0 },
      corporate_tax_rate: 0.30,
      effective_tax_rate: 0,
      computed_tax: false,
      profit_after_tax: 0,
      discontinued_operations: { total: 0 },
      profit_for_period: 0,
      other_comprehensive_income: { lines: [], total: 0 },
      total_comprehensive_income: 0,
      profit_attributable_to_owners: 0,
      profit_attributable_to_nci: 0,
      comprehensive_income_attributable_to_owners: 0,
      comprehensive_income_attributable_to_nci: 0,
      earnings_per_share: {
        weighted_avg_shares: 0,
        basic_eps: null,
        diluted_eps: null
      },
      net_profit: 0,
      net_margin_pct: 0,
      is_profit: true,
      operating_expenses: { lines: [], total: 0 },
      expenses: { lines: [], total: 0 }
    };
  }
}

module.exports = PLStatementService;
