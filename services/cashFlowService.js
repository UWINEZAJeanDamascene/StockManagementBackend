const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');
const { BankAccount } = require('../models/BankAccount');
const { PettyCashFloat } = require('../models/PettyCash');
const { CASH_FLOW_CLASSIFICATION, VERIFY_RECONCILIATION, RECONCILIATION_TOLERANCE } = require('../config/cashFlowConfig');

/**
 * Cash Flow Statement Service
 * 
 * Shows how cash moved in and out of the business in a period
 * across three sections: Operating, Investing, and Financing.
 * 
 * Uses embedded lines in JournalEntry
 * Classification configuration loaded from config/cashFlowConfig.js
 */
class CashFlowService {

  // Classification mapping by source_type (from config)
  static CASH_FLOW_CLASSIFICATION = CASH_FLOW_CLASSIFICATION;

  /**
   * Generate Cash Flow Statement report
   * @param {string} companyId - Company ID
   * @param {object} options - { dateFrom, dateTo }
   */
  static async generate(companyId, { dateFrom, dateTo }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!dateFrom || !dateTo) throw new Error('DATE_RANGE_REQUIRED');

    // Get all bank account ledger account IDs for this company
    const bankAccounts = await BankAccount.find({
      company: new mongoose.Types.ObjectId(companyId),
      isActive: true
    }).lean();

    const bankLedgerAccountIds = bankAccounts.map(b =>
      b.ledgerAccountId?.toString()
    ).filter(Boolean);

    // Get petty cash funds
    const pettyCashFunds = await PettyCashFloat.find({
      company: new mongoose.Types.ObjectId(companyId),
      isActive: true
    }).lean();

    const cashAccountIds = [
      ...bankLedgerAccountIds,
      ...pettyCashFunds.map(f => f.ledgerAccountId?.toString()).filter(Boolean)
    ];

    // Get all cash-affecting journal entries in period classified by source_type
    // Using embedded lines approach with $unwind
    const cashMovements = await aggregateWithTimeout(JournalEntry, [
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
        $match: {
          'lines.accountCode': { $in: cashAccountIds }
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
          narrations: { $push: '$description' }
        }
      }
    ]);

    // Classify movements into sections
    const operating = { inflows: [], outflows: [] };
    const investing = { inflows: [], outflows: [] };
    const financing = { inflows: [], outflows: [] };

    for (const movement of cashMovements) {
      const sourceType = movement._id.source_type;
      // Cash in = DR on bank account, Cash out = CR on bank account
      const cashIn = movement.total_dr || 0;
      const cashOut = movement.total_cr || 0;
      const net = cashIn - cashOut;

      const entry = {
        source_type: sourceType,
        cash_in: Math.round(cashIn * 100) / 100,
        cash_out: Math.round(cashOut * 100) / 100,
        net: Math.round(net * 100) / 100
      };

      if (CashFlowService.CASH_FLOW_CLASSIFICATION.operating_inflows.includes(sourceType)) {
        operating.inflows.push(entry);
      } else if (CashFlowService.CASH_FLOW_CLASSIFICATION.operating_outflows.includes(sourceType)) {
        operating.outflows.push(entry);
      } else if (CashFlowService.CASH_FLOW_CLASSIFICATION.investing_inflows.includes(sourceType)) {
        investing.inflows.push(entry);
      } else if (CashFlowService.CASH_FLOW_CLASSIFICATION.investing_outflows.includes(sourceType)) {
        investing.outflows.push(entry);
      } else if (CashFlowService.CASH_FLOW_CLASSIFICATION.financing_inflows.includes(sourceType)) {
        financing.inflows.push(entry);
      } else if (CashFlowService.CASH_FLOW_CLASSIFICATION.financing_outflows.includes(sourceType)) {
        financing.outflows.push(entry);
      }
    }

    // Compute section totals
    const operatingTotal = CashFlowService._sectionNet(operating);
    const investingTotal = CashFlowService._sectionNet(investing);
    const financingTotal = CashFlowService._sectionNet(financing);
    const netCashChange = operatingTotal + investingTotal + financingTotal;

    // Get opening and closing cash balances
    const openingCashBalance = await CashFlowService._getTotalCashBalance(
      companyId,
      cashAccountIds,
      new Date('1900-01-01'),
      new Date(new Date(dateFrom).getTime() - 1)
    );

    const closingCashBalance = await CashFlowService._getTotalCashBalance(
      companyId,
      cashAccountIds,
      new Date('1900-01-01'),
      new Date(dateTo)
    );

    // Verification: opening + net change must equal closing
    const computedClosing = openingCashBalance + netCashChange;
    const reconciliationDiff = Math.abs(closingCashBalance - computedClosing);
    const isReconciled = reconciliationDiff < RECONCILIATION_TOLERANCE;

    return {
      company_id: companyId,
      date_from: dateFrom,
      date_to: dateTo,
      opening_cash_balance: Math.round(openingCashBalance * 100) / 100,
      operating: {
        inflows: operating.inflows,
        outflows: operating.outflows,
        net_cash_from_operating: Math.round(operatingTotal * 100) / 100
      },
      investing: {
        inflows: investing.inflows,
        outflows: investing.outflows,
        net_cash_from_investing: Math.round(investingTotal * 100) / 100
      },
      financing: {
        inflows: financing.inflows,
        outflows: financing.outflows,
        net_cash_from_financing: Math.round(financingTotal * 100) / 100
      },
      net_change_in_cash: Math.round(netCashChange * 100) / 100,
      closing_cash_balance: Math.round(closingCashBalance * 100) / 100,
      computed_closing_balance: Math.round(computedClosing * 100) / 100,
      is_reconciled: isReconciled,
      reconciliation_diff: Math.round(reconciliationDiff * 100) / 100,
      generated_at: new Date()
    };
  }

  static _sectionNet(section) {
    const inflow = section.inflows.reduce((s, e) => s + e.net, 0);
    const outflow = section.outflows.reduce((s, e) => s + e.net, 0);
    return inflow + outflow;
  }

  static async _getTotalCashBalance(companyId, cashAccountIds, dateFrom, dateTo) {
    if (!cashAccountIds.length) return 0;

    const result = await aggregateWithTimeout(JournalEntry, [
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'posted',
          date: { $gte: dateFrom, $lte: dateTo }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $in: cashAccountIds }
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
    const dr = result[0]?.total_dr || 0;
    const cr = result[0]?.total_cr || 0;
    return dr - cr;
  }
}

module.exports = CashFlowService;
