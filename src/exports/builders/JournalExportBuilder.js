/**
 * JournalExportBuilder - Builds journal entry export for accounting
 * Worker Layer: Transforms journal data for external auditor export
 * Format: Complies with standard accounting export requirements
 */

const JournalEntry = require('../../../models/JournalEntry');
const Account = require('../../../models/ChartOfAccount');

class JournalExportBuilder {
  /**
   * Get journal entries for export
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Journal data
   */
  static async build(companyId, options = {}) {
    const { 
      startDate = null,
      endDate = null,
      periodId = null,
      includeUnposted = false 
    } = options;

    const query = { company: companyId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (periodId) {
      query.period = periodId;
    }

    if (!includeUnposted) {
      query.status = 'posted';
    }

    const entries = await JournalEntry.find(query)
      .populate('lines.account', 'code name type')
      .populate('period', 'name')
      .sort({ date: 1, createdAt: 1 })
      .lean();

    return this.transform(entries);
  }

  /**
   * Transform journal data for export
   * Format suitable for external auditors
   * @param {Array} entries - Raw journal entries
   * @returns {Array} Transformed data
   */
  static transform(entries) {
    const rows = [];

    for (const entry of entries) {
      // Each line becomes a separate row in audit format
      for (const line of entry.lines || []) {
        rows.push({
          entryDate: entry.date,
          entryRef: entry.reference || entry._id.toString(),
          journalType: entry.journal || 'General',
          accountCode: line.account?.code || '',
          accountName: line.account?.name || '',
          accountType: line.account?.type || '',
          description: line.description || '',
          debit: line.debit || 0,
          credit: line.credit || 0,
          currency: entry.currency || 'USD',
          status: entry.status,
          period: entry.period?.name || '',
          postingDate: entry.postedAt || entry.createdAt,
          sourceDoc: entry.sourceDocument || '',
          createdBy: entry.createdBy || '',
          notes: entry.notes || ''
        });
      }
    }

    return rows;
  }

  /**
   * Get column definitions for export
   * @returns {Array} Column definitions
   */
  static getColumns() {
    return [
      { key: 'entryDate', name: 'Date', type: 'date', width: 12 },
      { key: 'entryRef', name: 'Reference', width: 15 },
      { key: 'journalType', name: 'Journal', width: 12 },
      { key: 'accountCode', name: 'Account Code', width: 12 },
      { key: 'accountName', name: 'Account Name', width: 25 },
      { key: 'accountType', name: 'Type', width: 10 },
      { key: 'description', name: 'Description', width: 30 },
      { key: 'debit', name: 'Debit', type: 'currency', width: 14 },
      { key: 'credit', name: 'Credit', type: 'currency', width: 14 },
      { key: 'currency', name: 'Currency', width: 8 },
      { key: 'status', name: 'Status', width: 8 },
      { key: 'period', name: 'Period', width: 12 }
    ];
  }

  /**
   * Generate audit summary
   * @param {Array} entries - Journal entries
   * @returns {Object} Summary data
   */
  static generateSummary(entries) {
    let totalDebit = 0;
    let totalCredit = 0;
    const accountTotals = {};

    for (const entry of entries) {
      for (const line of entry.lines || []) {
        totalDebit += line.debit || 0;
        totalCredit += line.credit || 0;

        const accCode = line.account?.code || 'Unknown';
        if (!accountTotals[accCode]) {
          accountTotals[accCode] = { debit: 0, credit: 0 };
        }
        accountTotals[accCode].debit += line.debit || 0;
        accountTotals[accCode].credit += line.credit || 0;
      }
    }

    return {
      totalDebit,
      totalCredit,
      netBalance: totalDebit - totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
      accountCount: Object.keys(accountTotals).length,
      entryCount: entries.length,
      accountTotals
    };
  }
}

module.exports = JournalExportBuilder;