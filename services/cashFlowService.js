const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');
const Company = require('../models/Company');
const { CASH_FLOW_CLASSIFICATION, RECONCILIATION_TOLERANCE } = require('../config/cashFlowConfig');

/**
 * Cash Flow Statement Service — IAS 7 Compliant
 *
 * Shows how cash and cash equivalents moved in and out of the business
 * in a period across three sections:
 *
 *   1. Operating Activities  — core business revenue & expenses
 *   2. Investing Activities  — acquisition/disposal of long-term assets
 *   3. Financing Activities  — equity and debt transactions
 *
 * Classification:
 *   - Primary: by sourceType (from cashFlowConfig)
 *   - Fallback: by account code (cash accounts: 1000, 1050, 1100, 1110, 1200)
 *
 * Reconciliation:
 *   Opening Cash Balance + Net Change = Closing Cash Balance
 */
class CashFlowService {

  // Known cash account codes (fallback for entries without sourceType classification)
  static CASH_ACCOUNT_CODES = ['1000', '1050', '1100', '1110', '1200'];

  // Standard IAS 7 line items by sourceType
  static SOURCE_TYPE_LABELS = {
    // Operating inflows
    ar_receipt: 'Receipts from customers',
    // Operating outflows
    ap_payment: 'Payments to suppliers',
    expense: 'Operating expenses paid',
    petty_cash_expense: 'Petty cash expenses',
    tax_settlement: 'Taxes paid',
    tax_payment: 'Taxes paid',
    vat_settlement: 'VAT paid',
    paye_settlement: 'PAYE paid',
    rssb_settlement: 'RSSB paid',
    payroll_run: 'Salaries and wages paid',
    payroll_salary: 'Salaries and wages paid',
    // Investing inflows
    asset_disposal: 'Proceeds from disposal of assets',
    // Investing outflows
    asset_purchase: 'Purchase of property, plant & equipment',
    asset: 'Purchase of assets',
    // Financing inflows
    liability_drawdown: 'Proceeds from borrowings',
    loan: 'Proceeds from borrowings',
    opening_balance: 'Opening balance adjustments',
    // Financing outflows
    liability_repayment: 'Repayment of borrowings',
    liability_interest: 'Interest paid on borrowings',
    dividend: 'Dividends paid',
  };

  /**
   * Generate Cash Flow Statement report
   * @param {string} companyId
   * @param {object} options — { dateFrom, dateTo, comparativeDateFrom, comparativeDateTo }
   */
  static async generate(companyId, { dateFrom, dateTo, comparativeDateFrom, comparativeDateTo }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!dateFrom || !dateTo) throw new Error('DATE_RANGE_REQUIRED');

    const company = await Company.findById(companyId).lean();

    const [currentPeriod, comparativePeriod] = await Promise.all([
      CashFlowService._buildPeriodData(companyId, dateFrom, dateTo),
      comparativeDateFrom && comparativeDateTo
        ? CashFlowService._buildPeriodData(companyId, comparativeDateFrom, comparativeDateTo)
        : null
    ]);

    return {
      company_id: companyId,
      company_name: company?.name || '',
      date_from: dateFrom,
      date_to: dateTo,
      comparative_date_from: comparativeDateFrom || null,
      comparative_date_to: comparativeDateTo || null,
      current: currentPeriod,
      comparative: comparativePeriod,
      generated_at: new Date()
    };
  }

  /**
   * Build cash flow data for a period
   * @private
   */
  static async _buildPeriodData(companyId, dateFrom, dateTo) {
    // ── Step 1: Get cash account codes ─────────────────────────────
    // Try from BankAccount/PettyCashFloat models, fall back to known codes
    let cashAccountCodes = [];

    try {
      const BankAccount = require('../models/BankAccount');
      const { PettyCashFloat } = require('../models/PettyCash');

      const [bankAccounts, pettyCashFunds] = await Promise.all([
        BankAccount.find({ company: new mongoose.Types.ObjectId(companyId), isActive: true }).lean(),
        PettyCashFloat.find({ company: new mongoose.Types.ObjectId(companyId), isActive: true }).lean()
      ]);

      cashAccountCodes = [
        ...bankAccounts.map(b => b.ledgerAccountId?.toString()).filter(Boolean),
        ...pettyCashFunds.map(f => f.ledgerAccountId?.toString()).filter(Boolean)
      ];
    } catch {
      // Models not available — fall through to default codes
    }

    // If no bank/petty cash records, use known cash account codes
    if (cashAccountCodes.length === 0) {
      cashAccountCodes = CashFlowService.CASH_ACCOUNT_CODES;
    }

    // ── Step 2: Get all cash-affecting journal entries ─────────────
    const cashMovements = await aggregateWithTimeout(JournalEntry, [
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
        $match: {
          'lines.accountCode': { $in: cashAccountCodes }
        }
      },
      {
        $group: {
          _id: {
            source_type: '$sourceType',
            account_code: '$lines.accountCode'
          },
          total_dr: { $sum: '$lines.debit' },
          total_cr: { $sum: '$lines.credit' },
          entry_count: { $sum: 1 },
          descriptions: { $push: '$description' }
        }
      }
    ]);

    // ── Step 3: Classify movements ─────────────────────────────────
    const sections = {
      operating: { inflows: [], outflows: [] },
      investing: { inflows: [], outflows: [] },
      financing: { inflows: [], outflows: [] }
    };

    for (const movement of cashMovements) {
      const sourceType = movement._id.source_type;
      const accountCode = movement._id.account_code;

      const cashIn = parseFloat(movement.total_dr?.toString() || '0');
      const cashOut = parseFloat(movement.total_cr?.toString() || '0');
      const net = Math.round((cashIn - cashOut) * 100) / 100;

      const label = CashFlowService.SOURCE_TYPE_LABELS[sourceType] || sourceType || 'Other';
      const section = CashFlowService._classifyEntry(sourceType, accountCode);
      const direction = net >= 0 ? 'inflows' : 'outflows';

      sections[section][direction].push({
        source_type: sourceType || 'unclassified',
        label: label,
        account_code: accountCode,
        cash_in: Math.round(cashIn * 100) / 100,
        cash_out: Math.round(cashOut * 100) / 100,
        net: net,
        entry_count: movement.entry_count || 0
      });
    }

    // ── Step 4: Compute section totals ─────────────────────────────
    const round = (n) => Math.round(n * 100) / 100;

    const sumSection = (section) => {
      const inflows = section.inflows.reduce((s, e) => s + e.net, 0);
      const outflows = section.outflows.reduce((s, e) => s + e.net, 0);
      return round(inflows + outflows);
    };

    const operatingTotal = sumSection(sections.operating);
    const investingTotal = sumSection(sections.investing);
    const financingTotal = sumSection(sections.financing);
    const netCashChange = round(operatingTotal + investingTotal + financingTotal);

    // ── Step 5: Opening and closing cash balances ──────────────────
    const openingCashBalance = await CashFlowService._getTotalCashBalance(
      companyId, cashAccountCodes,
      new Date('1900-01-01'),
      new Date(new Date(dateFrom).getTime() - 1)
    );

    const closingCashBalance = await CashFlowService._getTotalCashBalance(
      companyId, cashAccountCodes,
      new Date('1900-01-01'),
      new Date(dateTo)
    );

    // ── Step 6: Reconciliation check ───────────────────────────────
    const computedClosing = round(openingCashBalance + netCashChange);
    const reconciliationDiff = round(Math.abs(closingCashBalance - computedClosing));
    const isReconciled = reconciliationDiff < RECONCILIATION_TOLERANCE;

    // ── Step 7: Sort inflows/outflows by net amount descending ─────
    const sortFn = (a, b) => Math.abs(b.net) - Math.abs(a.net);
    sections.operating.inflows.sort(sortFn);
    sections.operating.outflows.sort(sortFn);
    sections.investing.inflows.sort(sortFn);
    sections.investing.outflows.sort(sortFn);
    sections.financing.inflows.sort(sortFn);
    sections.financing.outflows.sort(sortFn);

    return {
      opening_cash_balance: round(openingCashBalance),
      operating: {
        inflows: sections.operating.inflows,
        outflows: sections.operating.outflows,
        total_inflows: round(sections.operating.inflows.reduce((s, e) => s + e.cash_in, 0)),
        total_outflows: round(sections.operating.outflows.reduce((s, e) => s + e.cash_out, 0)),
        net_cash_from_operating: operatingTotal
      },
      investing: {
        inflows: sections.investing.inflows,
        outflows: sections.investing.outflows,
        total_inflows: round(sections.investing.inflows.reduce((s, e) => s + e.cash_in, 0)),
        total_outflows: round(sections.investing.outflows.reduce((s, e) => s + e.cash_out, 0)),
        net_cash_from_investing: investingTotal
      },
      financing: {
        inflows: sections.financing.inflows,
        outflows: sections.financing.outflows,
        total_inflows: round(sections.financing.inflows.reduce((s, e) => s + e.cash_in, 0)),
        total_outflows: round(sections.financing.outflows.reduce((s, e) => s + e.cash_out, 0)),
        net_cash_from_financing: financingTotal
      },
      net_change_in_cash: netCashChange,
      closing_cash_balance: round(closingCashBalance),
      computed_closing_balance: computedClosing,
      is_reconciled: isReconciled,
      reconciliation_diff: reconciliationDiff
    };
  }

  /**
   * Classify a journal entry into Operating / Investing / Financing
   * Primary: by sourceType from config
   * Fallback: by account code
   */
  static _classifyEntry(sourceType, _accountCode) {
    const cf = CASH_FLOW_CLASSIFICATION;

    if (!sourceType) return 'operating'; // default unclassified to operating

    if (cf.operating_inflows.includes(sourceType)) return 'operating';
    if (cf.operating_outflows.includes(sourceType)) return 'operating';
    if (cf.investing_inflows.includes(sourceType)) return 'investing';
    if (cf.investing_outflows.includes(sourceType)) return 'investing';
    if (cf.financing_inflows.includes(sourceType)) return 'financing';
    if (cf.financing_outflows.includes(sourceType)) return 'financing';

    // Unknown sourceType — default to operating (most common)
    return 'operating';
  }

  /**
   * Get total cash balance (DR - CR) for given cash accounts up to a date
   * @private
   */
  static async _getTotalCashBalance(companyId, cashAccountCodes, dateFrom, dateTo) {
    if (!cashAccountCodes.length) return 0;

    const result = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          reversed: { $ne: true },
          date: { $gte: dateFrom, $lte: dateTo }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $in: cashAccountCodes }
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

    // Cash accounts are asset accounts — normal balance debit
    const dr = parseFloat(result[0]?.total_dr?.toString() || '0');
    const cr = parseFloat(result[0]?.total_cr?.toString() || '0');
    return Math.round((dr - cr) * 100) / 100;
  }
}

module.exports = CashFlowService;
