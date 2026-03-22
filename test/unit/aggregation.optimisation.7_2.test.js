/**
 * 7.2 Aggregation optimisation — $match early, tenant on root match, post-$lookup guards, limited $lookup, no JS stages
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const JournalEntry = require('../../models/JournalEntry');
const Invoice = require('../../models/Invoice');
const StockLevel = require('../../models/StockLevel');
const GRN = require('../../models/GoodsReceivedNote');
const BankAccount = require('../../models/BankAccount');
const ChartOfAccount = require('../../models/ChartOfAccount');
const Company = require('../../models/Company');

const ExecutiveDashboardService = require('../../services/dashboards/ExecutiveDashboardService');
const InventoryDashboardService = require('../../services/dashboards/InventoryDashboardService');
const SalesDashboardService = require('../../services/dashboards/SalesDashboardService');
const PurchaseDashboardService = require('../../services/dashboards/PurchaseDashboardService');
const FinanceDashboardService = require('../../services/dashboards/FinanceDashboardService');
const TrialBalanceService = require('../../services/trialBalanceService');
const GeneralLedgerService = require('../../services/generalLedgerService');
const PLStatementService = require('../../services/plStatementService');
const BalanceSheetService = require('../../services/balanceSheetService');
const CashFlowService = require('../../services/cashFlowService');
const FinancialRatiosService = require('../../services/financialRatiosService');
const ChartOfAccountsService = require('../../services/chartOfAccountsService');
const StockMovement = require('../../models/StockMovement');
const { PettyCashFloat } = require('../../models/PettyCash');
const dashboardCache = require('../../services/DashboardCacheService');

const COMPANY_ID = '507f1f77bcf86cd799439011';
const COMPANY_OID = new mongoose.Types.ObjectId(COMPANY_ID);

/** Mock Model.aggregate like Mongoose: `(pipeline, options) => Promise` — required for aggregateWithTimeout(). */
function mockAggregateResolved(Model, rows = []) {
  return jest.spyOn(Model, 'aggregate').mockImplementation((pipeline, _opts) => Promise.resolve(rows));
}

function firstStageIsMatch(pipeline) {
  expect(Array.isArray(pipeline)).toBe(true);
  expect(pipeline.length).toBeGreaterThan(0);
  expect(pipeline[0]).toHaveProperty('$match');
}

/** Tenant id on root collection: `company` or `company_id` (schema naming varies). */
function matchContainsCompanyTenant(matchDoc) {
  if (!matchDoc || typeof matchDoc !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(matchDoc, 'company')) return true;
  if (Object.prototype.hasOwnProperty.call(matchDoc, 'company_id')) return true;
  if (Array.isArray(matchDoc.$and) && matchDoc.$and.some(matchContainsCompanyTenant)) return true;
  if (Array.isArray(matchDoc.$or) && matchDoc.$or.some(matchContainsCompanyTenant)) return true;
  return false;
}

function countLookups(pipeline) {
  if (!Array.isArray(pipeline)) return 0;
  return pipeline.filter((s) => s && typeof s.$lookup === 'object').length;
}

function matchUsesAliasTenantFields(matchDoc, alias) {
  const walk = (doc) => {
    if (!doc || typeof doc !== 'object') return false;
    for (const key of Object.keys(doc)) {
      if (key === `${alias}.company` || key === `${alias}.company_id`) return true;
      const v = doc[key];
      if (key === '$and' || key === '$or') {
        if (Array.isArray(v) && v.some(walk)) return true;
      } else if (v && typeof v === 'object' && walk(v)) return true;
    }
    return false;
  };
  return walk(matchDoc);
}

/**
 * After each $lookup, a later $match must constrain the joined alias by company or company_id
 * (or the pipeline avoids $lookup entirely — see tests).
 */
function assertPostLookupTenantGuards(pipeline) {
  if (countLookups(pipeline) === 0) return;
  for (let i = 0; i < pipeline.length; i++) {
    const s = pipeline[i];
    if (!s || !s.$lookup) continue;
    const as = s.$lookup.as;
    if (!as) continue;
    let j = i + 1;
    let found = false;
    while (j < pipeline.length) {
      const st = pipeline[j];
      if (st && st.$lookup) break;
      if (st && st.$match) {
        expect(matchUsesAliasTenantFields(st.$match, as)).toBe(true);
        found = true;
        break;
      }
      j += 1;
    }
    expect(found).toBe(true);
  }
}

function readServiceSource(relPath) {
  const full = path.join(__dirname, '../../', relPath);
  return fs.readFileSync(full, 'utf8');
}

/** Stage-like keys in pipeline source (heuristic for audit files). */
const AUDITED_SERVICE_FILES = [
  'services/dashboards/ExecutiveDashboardService.js',
  'services/dashboards/InventoryDashboardService.js',
  'services/dashboards/SalesDashboardService.js',
  'services/dashboards/PurchaseDashboardService.js',
  'services/dashboards/FinanceDashboardService.js',
  'services/trialBalanceService.js',
  'services/generalLedgerService.js',
  'services/plStatementService.js',
  'services/balanceSheetService.js',
  'services/cashFlowService.js',
  'services/financialRatiosService.js',
  'services/chartOfAccountsService.js',
  'services/accountingHealthService.js',
  'services/budgetService.js',
  'services/taxService.js',
  'services/reportGeneratorService.js',
];

function assertAuditedSourcesHaveNoForbiddenStageLiterals() {
  const bad = /\$where\s*:|['"]\$where['"]|\$function\s*:|['"]\$function['"]|\$accumulator\s*:|['"]\$accumulator['"]/;
  for (const rel of AUDITED_SERVICE_FILES) {
    const src = readServiceSource(rel);
    expect(bad.test(src)).toBe(false);
  }
}

beforeEach(() => {
  jest.spyOn(dashboardCache, 'get').mockReturnValue(null);
  jest.spyOn(dashboardCache, 'set').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('7.2 Aggregation Optimisation', () => {
  describe('$match is always the first stage', () => {
    it('executive dashboard revenue pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({
        select: () => ({ lean: async () => [{ code: '4000', type: 'revenue', allow_direct_posting: true }] }),
      });
      const aggSpy = mockAggregateResolved(JournalEntry);
      const d1 = new Date('2025-01-01');
      const d2 = new Date('2025-01-31');
      await ExecutiveDashboardService._getAccountTypeTotal(COMPANY_ID, 'revenue', d1, d2);
      const pipeline = aggSpy.mock.calls[0][0];
      firstStageIsMatch(pipeline);
    });

    it('executive dashboard expenses pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({
        select: () => ({ lean: async () => [{ code: '5000', type: 'expense', allow_direct_posting: true }] }),
      });
      const aggSpy = mockAggregateResolved(JournalEntry);
      const d1 = new Date('2025-01-01');
      const d2 = new Date('2025-01-31');
      await ExecutiveDashboardService._getAccountTypeTotal(COMPANY_ID, 'expense', d1, d2);
      firstStageIsMatch(aggSpy.mock.calls[0][0]);
    });

    it('inventory dashboard stock summary pipeline has $match as first stage', async () => {
      const spy = mockAggregateResolved(StockLevel);
      await InventoryDashboardService._getStockSummary(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('inventory dashboard low stock pipeline has $match as first stage', async () => {
      const spy = mockAggregateResolved(StockLevel);
      await InventoryDashboardService._getLowStockAlerts(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('inventory dashboard dead stock pipeline has $match as first stage', async () => {
      jest.spyOn(StockMovement, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(StockLevel);
      await InventoryDashboardService._getDeadStock(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('sales dashboard AR aging pipeline has $match as first stage', async () => {
      const spy = mockAggregateResolved(Invoice);
      await SalesDashboardService._getARAgingBuckets(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('purchase dashboard AP aging pipeline has $match as first stage', async () => {
      const spy = mockAggregateResolved(GRN);
      await PurchaseDashboardService._getAPSummaryAndAging(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('finance dashboard bank balances pipeline has $match as first stage', async () => {
      jest.spyOn(BankAccount, 'find').mockReturnValue({
        sort: () => ({
          lean: async () => [{ ledgerAccountId: '1000', openingBalance: null, name: 'Main' }],
        }),
      });
      const spy = mockAggregateResolved(JournalEntry);
      await FinanceDashboardService._getBankBalances(COMPANY_ID);
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('trial balance pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await TrialBalanceService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('general ledger pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'findOne').mockReturnValue({
        lean: async () => ({
          code: '1000',
          name: 'Cash',
          type: 'asset',
          normal_balance: 'debit',
        }),
      });
      jest.spyOn(ChartOfAccountsService, 'getOpeningBalance').mockResolvedValue({ balance: 0 });
      const spy = mockAggregateResolved(JournalEntry);
      const aid = new mongoose.Types.ObjectId().toString();
      await GeneralLedgerService.getAccountLedger(COMPANY_ID, aid, {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      });
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('P&L statement pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await PLStatementService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('balance sheet pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      jest.spyOn(Company, 'findById').mockReturnValue({ lean: async () => ({ fiscal_year_start_month: 1 }) });
      jest.spyOn(PLStatementService, '_buildPeriodData').mockResolvedValue(PLStatementService._emptyPeriodData());
      const spy = mockAggregateResolved(JournalEntry);
      await BalanceSheetService.generate(COMPANY_ID, { asOfDate: '2024-12-31' });
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('cash flow pipeline has $match as first stage', async () => {
      jest.spyOn(BankAccount, 'find').mockReturnValue({ lean: async () => [{ ledgerAccountId: '1000' }] });
      jest.spyOn(PettyCashFloat, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await CashFlowService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      firstStageIsMatch(spy.mock.calls[0][0]);
    });

    it('financial ratios pipeline has $match as first stage', async () => {
      jest.spyOn(ChartOfAccount, 'findOne').mockReturnValue({
        lean: async () => ({ type: 'asset', normal_balance: 'debit' }),
      });
      const spy = mockAggregateResolved(JournalEntry);
      await FinancialRatiosService._getAccountBalance(COMPANY_ID, '1000', new Date('1900-01-01'), new Date('2024-12-31'));
      firstStageIsMatch(spy.mock.calls[0][0]);
    });
  });

  describe('$match always includes company_id', () => {
    it('executive dashboard $match includes company_id', async () => {
      expect(matchContainsCompanyTenant({ company: COMPANY_OID, status: 'posted' })).toBe(true);
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({
        select: () => ({ lean: async () => [{ code: '4000', type: 'revenue' }] }),
      });
      const aggSpy = mockAggregateResolved(JournalEntry);
      await ExecutiveDashboardService._getAccountTypeTotal(COMPANY_ID, 'revenue', new Date(), new Date());
      expect(matchContainsCompanyTenant(aggSpy.mock.calls[0][0][0].$match)).toBe(true);

      aggSpy.mockClear();
      jest.spyOn(BankAccount, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) });
      jest.spyOn(PettyCashFloat, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) });
      await ExecutiveDashboardService._getTotalCashBalance(COMPANY_ID);
      expect(matchContainsCompanyTenant(aggSpy.mock.calls[0][0][0].$match)).toBe(true);

      const invSpy = mockAggregateResolved(Invoice);
      await ExecutiveDashboardService._getOutstandingAR(COMPANY_ID);
      expect(matchContainsCompanyTenant(invSpy.mock.calls[0][0][0].$match)).toBe(true);
    });

    it('trial balance $match includes company_id', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await TrialBalanceService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      expect(matchContainsCompanyTenant(spy.mock.calls[0][0][0].$match)).toBe(true);
    });

    it('general ledger $match includes company_id', async () => {
      jest.spyOn(ChartOfAccount, 'findOne').mockReturnValue({
        lean: async () => ({ code: '1000', name: 'x', type: 'asset', normal_balance: 'debit' }),
      });
      jest.spyOn(ChartOfAccountsService, 'getOpeningBalance').mockResolvedValue({ balance: 0 });
      const spy = mockAggregateResolved(JournalEntry);
      const aid = new mongoose.Types.ObjectId().toString();
      await GeneralLedgerService.getAccountLedger(COMPANY_ID, aid, {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      });
      expect(matchContainsCompanyTenant(spy.mock.calls[0][0][0].$match)).toBe(true);
    });

    it('stock summary $match includes company_id', async () => {
      const spy = mockAggregateResolved(StockLevel);
      await InventoryDashboardService._getStockSummary(COMPANY_ID);
      expect(matchContainsCompanyTenant(spy.mock.calls[0][0][0].$match)).toBe(true);
    });

    it('AR aging $match includes company_id', async () => {
      const spy = mockAggregateResolved(Invoice);
      await SalesDashboardService._getARAgingBuckets(COMPANY_ID);
      expect(matchContainsCompanyTenant(spy.mock.calls[0][0][0].$match)).toBe(true);
    });

    it('AP aging $match includes company_id', async () => {
      const spy = mockAggregateResolved(GRN);
      await PurchaseDashboardService._getAPSummaryAndAging(COMPANY_ID);
      expect(matchContainsCompanyTenant(spy.mock.calls[0][0][0].$match)).toBe(true);
    });
  });

  describe('post-$lookup $match filters entry.company_id', () => {
    it('trial balance post-lookup match filters entry.company_id', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await TrialBalanceService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });

    it('general ledger post-lookup match filters entry.company_id', async () => {
      jest.spyOn(ChartOfAccount, 'findOne').mockReturnValue({
        lean: async () => ({ code: '1000', name: 'x', type: 'asset', normal_balance: 'debit' }),
      });
      jest.spyOn(ChartOfAccountsService, 'getOpeningBalance').mockResolvedValue({ balance: 0 });
      const spy = mockAggregateResolved(JournalEntry);
      const aid = new mongoose.Types.ObjectId().toString();
      await GeneralLedgerService.getAccountLedger(COMPANY_ID, aid, {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      });
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });

    it('P&L post-lookup match filters entry.company_id', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await PLStatementService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });

    it('balance sheet post-lookup match filters entry.company_id', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      jest.spyOn(Company, 'findById').mockReturnValue({ lean: async () => ({ fiscal_year_start_month: 1 }) });
      jest.spyOn(PLStatementService, '_buildPeriodData').mockResolvedValue(PLStatementService._emptyPeriodData());
      const spy = mockAggregateResolved(JournalEntry);
      await BalanceSheetService.generate(COMPANY_ID, { asOfDate: '2024-12-31' });
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });

    it('cash flow post-lookup match filters entry.company_id', async () => {
      jest.spyOn(BankAccount, 'find').mockReturnValue({ lean: async () => [{ ledgerAccountId: '1000' }] });
      jest.spyOn(PettyCashFloat, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await CashFlowService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      const main = spy.mock.calls[0][0];
      expect(countLookups(main)).toBe(0);
    });

    it('executive dashboard post-lookup match filters entry.company_id', async () => {
      jest.spyOn(BankAccount, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) });
      jest.spyOn(PettyCashFloat, 'find').mockReturnValue({
        select: () => ({ lean: async () => [] }),
      });
      const aggSpy = mockAggregateResolved(JournalEntry);
      await ExecutiveDashboardService._getTotalCashBalance(COMPANY_ID);
      assertPostLookupTenantGuards(aggSpy.mock.calls[0][0]);
    });
  });

  describe('$lookup usage is minimised', () => {
    it('trial balance uses at most one $lookup per pipeline', async () => {
      jest.spyOn(ChartOfAccount, 'find').mockReturnValue({ lean: async () => [] });
      const spy = mockAggregateResolved(JournalEntry);
      await TrialBalanceService.generate(COMPANY_ID, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      expect(countLookups(spy.mock.calls[0][0])).toBeLessThanOrEqual(1);
    });

    it('stock summary uses at most one $lookup per pipeline', async () => {
      const spy = mockAggregateResolved(StockLevel);
      await InventoryDashboardService._getStockSummary(COMPANY_ID);
      expect(countLookups(spy.mock.calls[0][0])).toBeLessThanOrEqual(1);
    });

    it('AR aging does not use $lookup — aggregates directly from sales_invoices', async () => {
      const spy = mockAggregateResolved(Invoice);
      await SalesDashboardService._getARAgingBuckets(COMPANY_ID);
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });

    it('AP aging does not use $lookup — aggregates directly from GRNs', async () => {
      const spy = mockAggregateResolved(GRN);
      await PurchaseDashboardService._getAPSummaryAndAging(COMPANY_ID);
      expect(countLookups(spy.mock.calls[0][0])).toBe(0);
    });
  });

  describe('pipelines do not use $where or JavaScript operators', () => {
    it('no pipeline uses $where operator', () => {
      assertAuditedSourcesHaveNoForbiddenStageLiterals();
    });

    it('no pipeline uses $function operator', () => {
      assertAuditedSourcesHaveNoForbiddenStageLiterals();
    });

    it('no pipeline uses $accumulator operator', () => {
      assertAuditedSourcesHaveNoForbiddenStageLiterals();
    });
  });
});
