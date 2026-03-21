const mongoose = require('mongoose');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

/**
 * Trial Balance Service
 * 
 * Lists every account with activity in a period alongside its total DR movements,
 * total CR movements, and closing balance.
 * 
 * Fundamental invariant: SUM(all DR) = SUM(all CR)
 * 
 * Note: Uses embedded lines in JournalEntry (not separate JournalEntryLine collection)
 */
class TrialBalanceService {

  /**
   * Generate Trial Balance report
   * @param {string} companyId - Company ID
   * @param {object} options - { dateFrom, dateTo }
   */
  static async generate(companyId, { dateFrom, dateTo }) {
    if (!companyId) throw new Error('COMPANY_ID_REQUIRED');
    if (!dateFrom || !dateTo) throw new Error('DATE_RANGE_REQUIRED');
    if (new Date(dateFrom) > new Date(dateTo)) throw new Error('INVALID_DATE_RANGE');

    // Step 1 — Aggregate all posted journal lines by account in period
    // Using embedded lines approach with $unwind
    const lineAggregation = await JournalEntry.aggregate([
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
      },
      { $sort: { _id: 1 } }
    ]);

    if (lineAggregation.length === 0) {
      return {
        company_id: companyId,
        date_from: dateFrom,
        date_to: dateTo,
        lines: [],
        total_dr: 0,
        total_cr: 0,
        is_balanced: true,
        difference: 0,
        generated_at: new Date()
      };
    }

    // Step 2 — Enrich with account details from chart of accounts
    const accountCodes = lineAggregation.map(l => l._id);
    const accounts = await ChartOfAccount.find({
      code: { $in: accountCodes },
      company: new mongoose.Types.ObjectId(companyId)
    }).lean();

    const accountMap = {};
    for (const acc of accounts) {
      accountMap[acc.code] = acc;
    }

    // Step 3 — Build trial balance lines
    const lines = lineAggregation.map(row => {
      const account = accountMap[row._id];
      const netDr = row.total_dr > row.total_cr ? row.total_dr - row.total_cr : 0;
      const netCr = row.total_cr > row.total_dr ? row.total_cr - row.total_dr : 0;

      return {
        account_id: account?._id || null,
        account_code: row._id,
        account_name: account?.name || 'Unknown Account',
        account_type: account?.type || 'unknown',
        total_dr: Math.round((row.total_dr || 0) * 100) / 100,
        total_cr: Math.round((row.total_cr || 0) * 100) / 100,
        // Net columns — shown in traditional two-column TB format
        net_dr: Math.round(netDr * 100) / 100,
        net_cr: Math.round(netCr * 100) / 100
      };
    });

    // Sort by account code for readability
    lines.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));

    // Step 4 — Compute totals and verify balance
    const totalDr = Math.round(lines.reduce((s, l) => s + l.total_dr, 0) * 100) / 100;
    const totalCr = Math.round(lines.reduce((s, l) => s + l.total_cr, 0) * 100) / 100;
    const difference = Math.round(Math.abs(totalDr - totalCr) * 100) / 100;
    const isBalanced = difference < 0.01;

    return {
      company_id: companyId,
      date_from: dateFrom,
      date_to: dateTo,
      lines,
      total_dr: totalDr,
      total_cr: totalCr,
      net_dr_total: Math.round(lines.reduce((s, l) => s + l.net_dr, 0) * 100) / 100,
      net_cr_total: Math.round(lines.reduce((s, l) => s + l.net_cr, 0) * 100) / 100,
      is_balanced: isBalanced,
      difference,
      generated_at: new Date()
    };
  }
}

module.exports = TrialBalanceService;
