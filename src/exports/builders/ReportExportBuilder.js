/**
 * ReportExportBuilder - Builds report export data
 * Worker Layer: Transforms financial report data for export
 * Supports: Trial Balance, P&L, Balance Sheet, Cash Flow
 */

const TrialBalanceService = require('../../../services/trialBalanceService');
const PlStatementService = require('../../../services/plStatementService');
const BalanceSheetService = require('../../../services/balanceSheetService');
const CashFlowService = require('../../../services/cashFlowService');

class ReportExportBuilder {
  /**
   * Build report data for export
   * @param {string} companyId - Company ID
   * @param {string} reportType - Type of report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Report data
   */
  static async build(companyId, reportType, options = {}) {
    const { periodId, startDate, endDate } = options;

    let reportData;
    let columns;

    switch (reportType) {
      case 'trial-balance':
        reportData = await this.buildTrialBalance(companyId, periodId);
        columns = this.getTrialBalanceColumns();
        break;

      case 'profit-loss':
      case 'income-statement':
        reportData = await this.buildProfitLoss(companyId, periodId, startDate, endDate);
        columns = this.getProfitLossColumns();
        break;

      case 'balance-sheet':
        reportData = await this.buildBalanceSheet(companyId, periodId);
        columns = this.getBalanceSheetColumns();
        break;

      case 'cash-flow':
        reportData = await this.buildCashFlow(companyId, periodId, startDate, endDate);
        columns = this.getCashFlowColumns();
        break;

      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }

    return { data: reportData, columns };
  }

  static async buildTrialBalance(companyId, periodId) {
    const data = await TrialBalanceService.generate(companyId, periodId);
    return data.accounts.map(acc => ({
      accountCode: acc.account.code,
      accountName: acc.account.name,
      accountType: acc.account.type,
      debit: acc.debitBalance || 0,
      credit: acc.creditBalance || 0,
      debitBalance: acc.debitBalance || 0,
      creditBalance: acc.creditBalance || 0
    }));
  }

  static async buildProfitLoss(companyId, periodId, startDate, endDate) {
    const data = await PlStatementService.generate(companyId, periodId, startDate, endDate);
    return data.lines.map(line => ({
      accountCode: line.account?.code || '',
      accountName: line.accountName,
      accountType: line.accountType,
      amount: line.balance,
      isHeader: line.isHeader || false,
      level: line.level || 0
    }));
  }

  static async buildBalanceSheet(companyId, periodId) {
    const data = await BalanceSheetService.generate(companyId, periodId);
    return data.lines.map(line => ({
      accountCode: line.account?.code || '',
      accountName: line.accountName,
      accountType: line.accountType,
      amount: line.balance,
      section: line.section,
      isHeader: line.isHeader || false,
      level: line.level || 0
    }));
  }

  static async buildCashFlow(companyId, periodId, startDate, endDate) {
    const data = await CashFlowService.generate(companyId, periodId, startDate, endDate);
    return data.lines.map(line => ({
      category: line.category,
      description: line.description,
      amount: line.amount,
      section: line.section,
      isHeader: line.isHeader || false
    }));
  }

  static getTrialBalanceColumns() {
    return [
      { key: 'accountCode', name: 'Account Code', width: 12 },
      { key: 'accountName', name: 'Account Name', width: 30 },
      { key: 'accountType', name: 'Type', width: 10 },
      { key: 'debit', name: 'Debit', type: 'currency', width: 15 },
      { key: 'credit', name: 'Credit', type: 'currency', width: 15 }
    ];
  }

  static getProfitLossColumns() {
    return [
      { key: 'accountCode', name: 'Account Code', width: 12 },
      { key: 'accountName', name: 'Account Name', width: 35 },
      { key: 'accountType', name: 'Type', width: 10 },
      { key: 'amount', name: 'Amount', type: 'currency', width: 15 }
    ];
  }

  static getBalanceSheetColumns() {
    return [
      { key: 'accountCode', name: 'Account Code', width: 12 },
      { key: 'accountName', name: 'Account Name', width: 35 },
      { key: 'accountType', name: 'Type', width: 10 },
      { key: 'amount', name: 'Balance', type: 'currency', width: 15 },
      { key: 'section', name: 'Section', width: 12 }
    ];
  }

  static getCashFlowColumns() {
    return [
      { key: 'category', name: 'Category', width: 15 },
      { key: 'description', name: 'Description', width: 40 },
      { key: 'section', name: 'Section', width: 15 },
      { key: 'amount', name: 'Amount', type: 'currency', width: 15 }
    ];
  }
}

module.exports = ReportExportBuilder;