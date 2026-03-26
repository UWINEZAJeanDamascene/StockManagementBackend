/**
 * OfxParser - OFX/QFX bank statement parser
 * Worker Layer: Parses OFX/QFX format bank statements
 * Note: Full OFX parsing requires ofx-js package, this is a simplified implementation
 */

const fs = require('fs');

class OfxParser {
  /**
   * Parse OFX file from file path
   * @param {string} filePath - Path to OFX file
   * @returns {Promise<Object>} Parsed OFX data
   */
  static async parseFile(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return this.parseString(content);
  }

  /**
   * Parse OFX from buffer/string
   * @param {string} content - OFX content
   * @returns {Promise<Object>} Parsed OFX data
   */
  static async parseString(content) {
    // Handle SGML format (traditional OFX)
    const sgmlData = this.parseSgml(content);
    
    // Extract bank account info
    const bankAccount = this.extractBankAccount(sgmlData);
    
    // Extract transactions
    const transactions = this.extractTransactions(sgmlData);
    
    return {
      version: '1',
      account: bankAccount,
      transactions,
      balance: this.extractBalance(sgmlData)
    };
  }

  /**
   * Simple SGML parser for OFX
   * @param {string} content - OFX content
   * @returns {Object} Parsed key-value pairs
   */
  static parseSgml(content) {
    const result = {};
    const tagRegex = /<([A-Z]+)>([^<]+)/gi;
    let match;
    
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1].toUpperCase();
      const value = match[2].trim();
      result[tag] = value;
    }
    
    return result;
  }

  /**
   * Extract bank account information
   * @param {Object} data - Parsed OFX data
   * @returns {Object} Bank account details
   */
  static extractBankAccount(data) {
    return {
      bankId: data.BANKID || '',
      accountId: data.ACCTID || '',
      accountType: data.ACCTTYPE || 'CHECKING'
    };
  }

  /**
   * Extract transactions from OFX
   * Note: Full STMTTRN parsing requires more complex parsing
   * @param {Object} data - Parsed OFX data
   * @returns {Array} Transactions
   */
  static extractTransactions(data) {
    // This is simplified - real OFX has nested transaction blocks
    // For full OFX support, install ofx-js package
    const transactions = [];
    
    // Try to extract from OFX transaction list if present
    if (data.STMTTRN) {
      const trx = data.STMTTRN;
      transactions.push({
        fitId: trx.FITID || '',
        date: this.parseOfxDate(trx.DTPOSTED),
        amount: parseFloat(trx.TRNAMT) || 0,
        name: trx.NAME || '',
        memo: trx.MEMO || '',
        type: trx.TYPE || ''
      });
    }
    
    return transactions;
  }

  /**
   * Extract available balance
   * @param {Object} data - Parsed OFX data
   * @returns {Object} Balance info
   */
  static extractBalance(data) {
    return {
      available: parseFloat(data.AVAILABLEBAL || data.BALAMT || 0),
      ledger: parseFloat(data.LEDGERBAL || 0),
      date: this.parseOfxDate(data.DTASOF)
    };
  }

  /**
   * Parse OFX date format (YYYYMMDDHHMMSS or YYYYMMDD)
   * @param {string} dateStr - OFX date string
   * @returns {Date|null} Parsed date
   */
  static parseOfxDate(dateStr) {
    if (!dateStr) return null;
    
    try {
      // Handle format: YYYYMMDDHHMMSS
      if (dateStr.length >= 8) {
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        
        let hour = 0, min = 0, sec = 0;
        if (dateStr.length >= 14) {
          hour = parseInt(dateStr.substring(8, 10));
          min = parseInt(dateStr.substring(10, 12));
          sec = parseInt(dateStr.substring(12, 14));
        }
        
        return new Date(year, month, day, hour, min, sec);
      }
      
      return new Date(dateStr);
    } catch (e) {
      return null;
    }
  }

  /**
   * Convert transactions to standardized format
   * @param {Array} transactions - Raw OFX transactions
   * @returns {Array} Standardized transactions
   */
  static standardizeTransactions(transactions) {
    return transactions.map(trx => ({
      date: trx.date,
      description: trx.name || trx.memo,
      reference: trx.fitId,
      debit: trx.amount < 0 ? Math.abs(trx.amount) : 0,
      credit: trx.amount > 0 ? trx.amount : 0,
      balance: null, // OFX doesn't always provide running balance
      type: trx.type,
      memo: trx.memo
    }));
  }
}

module.exports = OfxParser;