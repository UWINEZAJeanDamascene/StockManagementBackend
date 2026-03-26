/**
 * OpeningBalanceValidator - Validates opening balance import data
 * Worker Layer: Field-level validation for opening balance CSV imports
 * 
 * IMPORTANT: This import is ATOMIC - entire file must be valid before any writes
 * 
 * Expected CSV columns:
 * - account_code (required, must exist in chart_of_accounts)
 * - account_name (optional, for reference)
 * - entry_type (required, 'debit' or 'credit')
 * - amount (required, positive number)
 * - description (optional)
 * 
 * Validation:
 * 1. Every account_code must exist in chart_of_accounts
 * 2. entry_type must be debit or credit
 * 3. amount must be positive
 * 4. SUM(debits) must equal SUM(credits) - file rejected if not balanced
 */

const Account = require('../../../models/ChartOfAccount');
const JournalEntry = require('../../../models/JournalEntry');

class OpeningBalanceValidator {
  static COLUMN_MAPPING = {
    'account_code': 'accountCode',
    'code': 'accountCode',
    'account': 'accountCode',
    'account_name': 'accountName',
    'name': 'accountName',
    'entry_type': 'entryType',
    'type': 'entryType',
    'side': 'entryType',
    'amount': 'amount',
    'value': 'amount',
    'debit': 'debitAmount',
    'credit': 'creditAmount',
    'description': 'description',
    'notes': 'description',
    'memo': 'description'
  };

  static REQUIRED = ['accountCode', 'amount'];
  static VALID_ENTRY_TYPES = ['debit', 'credit'];

  /**
   * Validate entire file atomically
   * @param {Array} records - All CSV records
   * @param {string} companyId - Company ID
   * @returns {Object} Validation result with file-level checks
   */
  static async validateFile(records, companyId) {
    const errors = [];
    let accountCode, entryType, amount, description;
    const accountCodes = new Set();
    let totalDebits = 0;
    let totalCredits = 0;
    const accountMap = new Map();

    // First, get all accounts for this company
    const accounts = await Account.find({ company: companyId }).lean();
    accounts.forEach(acc => {
      accountMap.set(acc.code.toUpperCase(), acc);
    });

    // Validate each row and compute totals
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // +2 for 1-based and header row
      const normalized = this.normalize(record);

      // Check account_code exists
      accountCode = normalized.accountCode ? normalized.accountCode.trim().toUpperCase() : '';
      if (!accountCode) {
        errors.push({
          row: rowNum,
          field: 'account_code',
          message: 'Account code is required',
          value: record.account_code
        });
        continue;
      }

      const account = accountMap.get(accountCode);
      if (!account) {
        errors.push({
          row: rowNum,
          field: 'account_code',
          message: `Account code "${accountCode}" not found in chart of accounts`,
          value: record.account_code
        });
      }

      // Check entry_type
      entryType = (normalized.entryType || normalized.debitAmount ? 'debit' : normalized.creditAmount ? 'credit' : '').toLowerCase();
      if (!this.VALID_ENTRY_TYPES.includes(entryType)) {
        // Try to determine from debit/credit columns
        if (normalized.debitAmount && parseFloat(normalized.debitAmount) > 0) {
          entryType = 'debit';
        } else if (normalized.creditAmount && parseFloat(normalized.creditAmount) > 0) {
          entryType = 'credit';
        } else {
          errors.push({
            row: rowNum,
            field: 'entry_type',
            message: 'Entry type must be "debit" or "credit"',
            value: record.entry_type
          });
        }
      }

      // Check amount is positive
      const debitVal = parseFloat(normalized.debitAmount) || 0;
      const creditVal = parseFloat(normalized.creditAmount) || 0;
      amount = parseFloat(normalized.amount) || (debitVal + creditVal);
      
      if (isNaN(amount) || amount <= 0) {
        errors.push({
          row: rowNum,
          field: 'amount',
          message: 'Amount must be a positive number',
          value: record.amount || record.debit || record.credit
        });
      }

      // Compute totals
      if (entryType === 'debit') {
        totalDebits += amount;
      } else if (entryType === 'credit') {
        totalCredits += amount;
      }
    }

    // Check balance
    const difference = Math.abs(totalDebits - totalCredits);
    if (difference > 0.01) {
      errors.push({
        row: 0,
        field: 'balance',
        message: `Journal entry is not balanced. Total Debits: ${totalDebits.toFixed(2)}, Total Credits: ${totalCredits.toFixed(2)}, Difference: ${difference.toFixed(2)}`,
        value: ''
      });
    }

    // Check for existing journal entries (prevent double import)
    const existingEntries = await JournalEntry.countDocuments({
      company: companyId,
      isOpeningBalance: true
    });

    if (existingEntries > 0) {
      errors.push({
        row: 0,
        field: 'existing',
        message: 'Opening balance has already been imported. Cannot import again.',
        value: ''
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      summary: {
        totalDebits,
        totalCredits,
        difference,
        balanced: difference < 0.01,
        rowCount: records.length
      }
    };
  }

  /**
   * Validate a single row (for partial validation if needed)
   * @param {Object} record - Raw CSV record
   * @param {number} rowNum - Row number
   * @returns {Object} Validation result
   */
  static validate(record, rowNum) {
    const errors = [];
    const normalized = this.normalize(record);

    if (!normalized.accountCode || normalized.accountCode.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'account_code',
        message: 'Account code is required',
        value: record.account_code
      });
    }

    if (!normalized.amount || normalized.amount.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'amount',
        message: 'Amount is required',
        value: record.amount
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      data: normalized
    };
  }

  static normalize(record) {
    const normalized = {};
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = this.COLUMN_MAPPING[key.toLowerCase().trim()] || key;
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  static validateHeaders(headers) {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const hasRequired = this.REQUIRED.every(req => 
      normalizedHeaders.some(h => this.COLUMN_MAPPING[h] === req)
    );

    return {
      valid: hasRequired,
      message: hasRequired ? 'Valid' : `Missing required columns: ${this.REQUIRED.join(', ')}`,
      columns: normalizedHeaders
    };
  }
}

module.exports = OpeningBalanceValidator;