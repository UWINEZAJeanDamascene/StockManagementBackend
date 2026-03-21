const AccountingPeriod = require('../models/AccountingPeriod');
const JournalService = require('./journalService');
const AuditLogService = require('./AuditLogService');

class PeriodService {

  /**
   * Called by JournalService before every post — already wired in
   * Returns the ID of the open period for the given date
   * Checks both new AccountingPeriod and legacy Period models
   */
  static async getOpenPeriodId(companyId, date) {
    const dateObj = new Date(date);
    
    // Check new AccountingPeriod model first
    const newPeriod = await AccountingPeriod.findOne({
      company_id: companyId,
      status: 'open',
      start_date: { $lte: dateObj },
      end_date: { $gte: dateObj }
    });

    if (newPeriod) {
      return newPeriod._id;
    }
    
    // Check legacy Period model for backward compatibility
    // Wrap in try-catch because legacy model expects ObjectId for company field
    try {
      const Period = require('../models/Period');
      const legacyPeriod = await Period.findOne({
        company: companyId,
        status: 'open',
        startDate: { $lte: dateObj },
        endDate: { $gte: dateObj }
      });

      if (legacyPeriod) {
        return legacyPeriod._id;
      }
    } catch (legacyError) {
      // Legacy model may fail if companyId is not a valid ObjectId - ignore and continue
    }

    throw new Error(
      `PERIOD_CLOSED: No open accounting period found for date ${date}. ` +
      `Create or open a period that covers this date.`
    );
  }

  /**
   * Check if a period exists and is open — returns boolean
   */
  static async isOpen(companyId, date) {
    try {
      await PeriodService.getOpenPeriodId(companyId, date);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a date falls within a closed period
   * Used by journalService to prevent posting to closed periods
   * Checks both new AccountingPeriod and legacy Period models for backward compatibility
   */
  static async isDateInClosedPeriod(companyId, date) {
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // Check new AccountingPeriod model first
    const newPeriod = await AccountingPeriod.findOne({
      company_id: companyId,
      start_date: { $lte: dateObj },
      end_date: { $gte: dateObj }
    });
    
    if (newPeriod) {
      return newPeriod.status === 'closed' || newPeriod.status === 'locked';
    }
    
    // Check legacy Period model for backward compatibility
    // Wrap in try-catch because legacy model expects ObjectId for company field
    try {
      const Period = require('../models/Period');
      const legacyPeriod = await Period.findOne({
        company: companyId,
        startDate: { $lte: dateObj },
        endDate: { $gte: dateObj }
      });
      
      if (!legacyPeriod) {
        // No period exists for this date - treat as open (will be caught elsewhere)
        return false;
      }
      
      return legacyPeriod.status === 'closed';
    } catch (legacyError) {
      // Legacy model may fail if companyId is not a valid ObjectId - treat as not closed
      return false;
    }
  }

  /**
   * Get open period ID - checks both new and legacy models
   */
  static async _getOpenPeriodIdFromModel(model, companyId, dateObj) {
    let period;
    if (model === 'new') {
      period = await AccountingPeriod.findOne({
        company_id: companyId,
        status: 'open',
        start_date: { $lte: dateObj },
        end_date: { $gte: dateObj }
      });
    } else {
      // Legacy Period model
      const Period = require('../models/Period');
      period = await Period.findOne({
        company: companyId,
        status: 'open',
        startDate: { $lte: dateObj },
        endDate: { $gte: dateObj }
      });
    }
    return period;
  }

  /**
   * Generate 12 monthly periods for a fiscal year
   */
  static async generateFiscalYear(companyId, fiscalYear, userId) {
    const Company = require('../models/Company');
    const company = await Company.findById(companyId);
    if (!company) throw new Error('COMPANY_NOT_FOUND');

    const startMonth = company.fiscal_year_start_month; // e.g. 7 for July
    const periods = [];

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    for (let i = 0; i < 12; i++) {
      const monthOffset = (startMonth - 1 + i) % 12;
      const yearOffset = Math.floor((startMonth - 1 + i) / 12);
      const year = fiscalYear + yearOffset;
      const month = monthOffset; // 0-indexed

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0); // last day of month
      endDate.setHours(23, 59, 59, 999);

      periods.push({
        company_id: companyId,
        name: `${monthNames[month]} ${year}`,
        period_type: 'month',
        start_date: startDate,
        end_date: endDate,
        fiscal_year: fiscalYear,
        status: 'open',
        is_year_end: i === 11 // last month of fiscal year
      });
    }

    // Insert all — skip any that already exist (idempotent)
    const results = [];
    for (const period of periods) {
      const existing = await AccountingPeriod.findOne({
        company_id: companyId,
        start_date: period.start_date,
        end_date: period.end_date
      });
      if (!existing) {
        results.push(await AccountingPeriod.create(period));
      }
    }

    await AuditLogService.log({
      companyId,
      userId,
      action: 'periods.generate',
      entity_type: 'accounting_period',
      entity_id: null,
      changes: { fiscal_year: fiscalYear, periods_created: results.length }
    });

    return results;
  }

  /**
   * Close a period
   */
  static async closePeriod(companyId, periodId, userId) {
    const period = await AccountingPeriod.findOne({
      _id: periodId,
      company_id: companyId
    });
    
    if (!period) throw new Error('PERIOD_NOT_FOUND');
    if (period.status === 'locked') throw new Error('PERIOD_LOCKED');
    if (period.status === 'closed') throw new Error('PERIOD_ALREADY_CLOSED');

    // Warn if there are unreconciled bank transactions in this period
    const warningMessages = await PeriodService._checkClosingWarnings(
      companyId,
      period.start_date,
      period.end_date
    );

    await AccountingPeriod.findByIdAndUpdate(periodId, {
      $set: {
        status: 'closed',
        closed_by: userId,
        closed_at: new Date()
      }
    });

    await AuditLogService.log({
      companyId,
      userId,
      action: 'period.close',
      entity_type: 'accounting_period',
      entity_id: periodId,
      changes: { status: 'closed' }
    });

    return {
      success: true,
      warnings: warningMessages
    };
  }

  /**
   * Reopen a closed period
   */
  static async reopenPeriod(companyId, periodId, userId) {
    const period = await AccountingPeriod.findOne({
      _id: periodId,
      company_id: companyId
    });
    
    if (!period) throw new Error('PERIOD_NOT_FOUND');
    if (period.status === 'locked') throw new Error('PERIOD_LOCKED: locked periods cannot be reopened');
    if (period.status === 'open') throw new Error('PERIOD_ALREADY_OPEN');

    await AccountingPeriod.findByIdAndUpdate(periodId, {
      $set: { status: 'open', closed_by: null, closed_at: null }
    });

    await AuditLogService.log({
      companyId,
      userId,
      action: 'period.reopen',
      entity_type: 'accounting_period',
      entity_id: periodId,
      changes: { status: 'open' }
    });

    return { success: true };
  }

  /**
   * Lock a period permanently
   */
  static async lockPeriod(companyId, periodId, userId) {
    const period = await AccountingPeriod.findOne({
      _id: periodId,
      company_id: companyId
    });
    
    if (!period) throw new Error('PERIOD_NOT_FOUND');
    if (period.status === 'locked') throw new Error('PERIOD_ALREADY_LOCKED');

    await AccountingPeriod.findByIdAndUpdate(periodId, {
      $set: { status: 'locked' }
    });

    await AuditLogService.log({
      companyId,
      userId,
      action: 'period.lock',
      entity_type: 'accounting_period',
      entity_id: periodId,
      changes: { status: 'locked' }
    });

    return { success: true };
  }

  /**
   * Get all periods for a company with optional filters
   */
  static async getAll(companyId, filters = {}) {
    const query = { company_id: companyId };
    
    if (filters.fiscal_year) {
      query.fiscal_year = filters.fiscal_year;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.period_type) {
      query.period_type = filters.period_type;
    }

    const periods = await AccountingPeriod.find(query)
      .sort({ start_date: 1 })
      .lean();

    return periods;
  }

  /**
   * Get period by ID
   */
  static async getById(companyId, periodId) {
    const period = await AccountingPeriod.findOne({
      _id: periodId,
      company_id: companyId
    });

    if (!period) throw new Error('PERIOD_NOT_FOUND');
    return period;
  }

  /**
   * Get the currently open period for today's date
   */
  static async getCurrentPeriod(companyId) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const period = await AccountingPeriod.findOne({
      company_id: companyId,
      status: 'open',
      start_date: { $lte: today },
      end_date: { $gte: today }
    });

    return period;
  }

  /**
   * Year-end close — transfers P&L balances to retained earnings
   */
  static async performYearEndClose(companyId, fiscalYear, userId) {
    const PLStatementService = require('./plStatementService');
    const ChartOfAccounts = require('../models/ChartOfAccount');

    // Get the year-end period
    const yearEndPeriod = await AccountingPeriod.findOne({
      company_id: companyId,
      fiscal_year: fiscalYear,
      is_year_end: true
    });
    
    if (!yearEndPeriod) throw new Error('YEAR_END_PERIOD_NOT_FOUND');
    if (yearEndPeriod.year_end_close_entry_id) {
      throw new Error('YEAR_END_ALREADY_CLOSED');
    }

    // Get fiscal year start date (findOne doesn't support sort, use find with limit instead)
    const firstPeriodQuery = await AccountingPeriod.find({
      company_id: companyId,
      fiscal_year: fiscalYear
    }).sort({ start_date: 1 }).limit(1);
    
    const firstPeriod = firstPeriodQuery[0];

    if (!firstPeriod) throw new Error('FIRST_PERIOD_NOT_FOUND');

    // Compute P&L for the full fiscal year
    const pl = await PLStatementService._buildPeriodData(
      companyId,
      firstPeriod.start_date,
      yearEndPeriod.end_date
    );

    const netProfit = pl.net_profit;

    // Find retained earnings account
    const retainedEarningsAccount = await ChartOfAccounts.findOne({
      company: companyId,
      sub_type: 'retained',
      is_active: true
    });
    
    if (!retainedEarningsAccount) {
      throw new Error('RETAINED_EARNINGS_ACCOUNT_NOT_FOUND');
    }

    const closeLines = [];

    // Close revenue accounts (normal balance: credit) — DR each to zero
    for (const line of pl.revenue.lines) {
      if (line.amount !== 0) {
        closeLines.push({
          account: line.account_id,
          debit: line.amount, // debit to zero out credit balance
          credit: 0,
          description: `Year-end close: ${line.account_name}`
        });
      }
    }

    // Close COGS accounts (normal balance: debit) — CR each to zero
    for (const line of pl.cogs.lines) {
      if (line.amount !== 0) {
        closeLines.push({
          account: line.account_id,
          debit: 0,
          credit: line.amount, // credit to zero out debit balance
          description: `Year-end close: ${line.account_name}`
        });
      }
    }

    // Close expense accounts (normal balance: debit) — CR each to zero
    for (const line of pl.expenses.lines) {
      if (line.amount !== 0) {
        closeLines.push({
          account: line.account_id,
          debit: 0,
          credit: line.amount,
          description: `Year-end close: ${line.account_name}`
        });
      }
    }

    // Net goes to retained earnings
    // If profit: CR retained earnings
    // If loss: DR retained earnings
    closeLines.push({
      account: retainedEarningsAccount._id,
      debit: netProfit < 0 ? Math.abs(netProfit) : 0,
      credit: netProfit > 0 ? netProfit : 0,
      description: `Year-end close: Net ${netProfit >= 0 ? 'profit' : 'loss'} FY${fiscalYear}`
    });

    // Post the closing entry
    const closeEntry = await JournalService.createEntry(companyId, userId, {
      date: yearEndPeriod.end_date,
      description: `Year-End Close FY${fiscalYear} — Net ${netProfit >= 0 ? 'Profit' : 'Loss'}: ${netProfit}`,
      lines: closeLines,
      reference: `yearend_${companyId}_${fiscalYear}`
    });

    // Mark the year-end period with the close entry and lock it
    await AccountingPeriod.findByIdAndUpdate(yearEndPeriod._id, {
      $set: {
        year_end_close_entry_id: closeEntry._id,
        status: 'locked'
      }
    });

    // Lock all other periods in this fiscal year
    await AccountingPeriod.updateMany(
      { company_id: companyId, fiscal_year: fiscalYear },
      { $set: { status: 'locked' } }
    );

    await AuditLogService.log({
      companyId,
      userId,
      action: 'period.year_end_close',
      entity_type: 'accounting_period',
      entity_id: yearEndPeriod._id,
      changes: { fiscal_year: fiscalYear, net_profit: netProfit }
    });

    return {
      fiscal_year: fiscalYear,
      net_profit: netProfit,
      close_entry_id: closeEntry._id,
      periods_locked: true
    };
  }

  /**
   * Check for warnings before closing a period
   */
  static async _checkClosingWarnings(companyId, startDate, endDate) {
    const warnings = [];

    // Check for unreconciled bank statement lines
    try {
      const BankStatementLine = require('../models/BankStatementLine');
      const unreconciledCount = await BankStatementLine.countDocuments({
        company: companyId,
        transaction_date: { $gte: startDate, $lte: endDate },
        is_reconciled: false
      });
      if (unreconciledCount > 0) {
        warnings.push(
          `${unreconciledCount} unreconciled bank statement lines exist in this period`
        );
      }
    } catch (e) {
      // BankStatementLine may not exist, ignore
    }

    return warnings;
  }
}

module.exports = PeriodService;
