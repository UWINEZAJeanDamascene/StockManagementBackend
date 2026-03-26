/**
 * OpeningBalanceProcessor - Processes opening balance imports
 * Worker Layer: Creates journal entries for go-live balances
 */

const JournalEntry = require('../../../models/JournalEntry');
const Account = require('../../../models/ChartOfAccount');
const Period = require('../../../models/Period');

class OpeningBalanceProcessor {
  /**
   * Process opening balance import
   * Creates journal entries with debits/credits for each account
   * @param {Array} records - Validated opening balance records
   * @param {string} companyId - Company ID
   * @param {Object} options - Processing options
   * @returns {Object} Import result
   */
  static async process(records, companyId, options = {}) {
    const { periodId, description = 'Opening Balance Import' } = options;
    
    let created = 0;
    let errors = [];

    // Get all accounts by code
    const accounts = await Account.find({ company: companyId }).lean();
    const accountMap = new Map(accounts.map(a => [a.code.toLowerCase(), a]));

    // Find or create opening balance period
    let targetPeriod = null;
    if (periodId) {
      targetPeriod = await Period.findById(periodId);
    } else {
      // Find current open period
      targetPeriod = await Period.findOne({
        company: companyId,
        status: 'open',
        isClosed: false
      }).sort({ startDate: 1 });
    }

    if (!targetPeriod) {
      throw new Error('No open accounting period found. Please create or open a period first.');
    }

    // Build journal entry lines
    const lines = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const record of records) {
      try {
        const accountCode = record.accountCode.toLowerCase().trim();
        const account = accountMap.get(accountCode);

        if (!account) {
          errors.push({
            row: records.indexOf(record) + 1,
            field: 'accountCode',
            message: `Account code "${record.accountCode}" not found`,
            value: record.accountCode
          });
          continue;
        }

        let debit = 0;
        let credit = 0;

        // Determine debit/credit from amount or explicit debit/credit fields
        if (record.amount) {
          const amount = parseFloat(record.amount);
          // Determine normal balance type
          if (['asset', 'expense'].includes(account.type)) {
            // Normal debit balance - positive = debit
            debit = amount;
          } else {
            // Normal credit balance - positive = credit
            credit = amount;
          }
        } else {
          debit = parseFloat(record.debit) || 0;
          credit = parseFloat(record.credit) || 0;
        }

        if (debit > 0 || credit > 0) {
          lines.push({
            account: account._id,
            description: record.description || record.accountName || `Opening balance - ${account.name}`,
            debit,
            credit,
            company: companyId
          });
          totalDebit += debit;
          totalCredit += credit;
        }
      } catch (err) {
        errors.push({
          row: records.indexOf(record) + 1,
          field: 'balance',
          message: err.message,
          value: record.accountCode
        });
      }
    }

    // Validate balance
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal entry is not balanced. Debits: ${totalDebit}, Credits: ${totalCredit}`);
    }

    // Create journal entry
    if (lines.length > 0) {
      const journalEntry = await JournalEntry.create({
        date: targetPeriod.startDate,
        description,
        reference: `OB-${Date.now()}`,
        lines,
        company: companyId,
        period: targetPeriod._id,
        status: 'posted',
        isOpeningBalance: true
      });
      created = lines.length;
    }

    return {
      created,
      updated: 0,
      skipped: 0,
      errors,
      journalEntryId: journalEntry?._id,
      totalDebit,
      totalCredit
    };
  }
}

module.exports = OpeningBalanceProcessor;