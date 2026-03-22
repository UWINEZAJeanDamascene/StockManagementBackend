const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const RatiosWidgetService = require('../../services/dashboards/RatiosWidgetService')
const FinancialRatiosService = require('../../services/financialRatiosService')
const dashboardCache = require('../../services/DashboardCacheService')
const dateHelpers = require('../../utils/dateHelpers')
const Company = require('../../models/Company')

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

function nineRatioPayload(overrides = {}) {
  return {
    company_id: 'x',
    as_of_date: '2024-01-01',
    date_from: '2024-01-01',
    date_to: '2024-01-01',
    ratios: {
      current_ratio: {
        value: 2,
        formula: 'Current Assets ÷ Current Liabilities',
        inputs: {},
        status: 'good',
        ...overrides.current_ratio
      },
      quick_ratio: {
        value: 1,
        formula: 'Quick',
        inputs: {},
        status: 'warning',
        ...overrides.quick_ratio
      },
      gross_margin_pct: {
        value: 40,
        formula: 'Gross',
        inputs: {},
        status: 'danger',
        ...overrides.gross_margin_pct
      },
      inventory_turnover: {
        value: 4,
        formula: 'Inv',
        inputs: {},
        status: 'neutral',
        ...overrides.inventory_turnover
      },
      days_inventory_outstanding: {
        value: 90,
        formula: 'DIO',
        inputs: {},
        status: 'good',
        ...overrides.days_inventory_outstanding
      },
      ap_turnover: {
        value: 6,
        formula: 'AP',
        inputs: {},
        status: 'warning',
        ...overrides.ap_turnover
      },
      return_on_assets: {
        value: 5,
        formula: 'ROA',
        inputs: {},
        status: 'danger',
        ...overrides.return_on_assets
      },
      debt_to_equity: {
        value: 1,
        formula: 'D/E',
        inputs: {},
        status: 'neutral',
        ...overrides.debt_to_equity
      },
      net_profit_margin_pct: {
        value: 12,
        formula: 'NPM',
        inputs: {},
        status: 'good',
        ...overrides.net_profit_margin_pct
      }
    },
    generated_at: new Date()
  }
}

describe('RatiosWidgetService', () => {
  let companyA
  let companyB

  beforeEach(async () => {
    dashboardCache.clearAll()
    const suffix = new mongoose.Types.ObjectId().toString()
    companyA = await Company.create({
      name: 'Co A',
      code: `RW${suffix}`,
      email: `a-${suffix}@test.com`,
      fiscal_year_start_month: 1
    })
    companyB = await Company.create({
      name: 'Co B',
      code: `RX${suffix}`,
      email: `b-${suffix}@test.com`,
      fiscal_year_start_month: 1
    })
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    jest.useRealTimers()
    await Company.deleteMany({})
    dashboardCache.clearAll()
  })

  it('returns all 9 ratios', async () => {
    jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    const result = await RatiosWidgetService.get(companyA._id.toString())

    expect(result.ratios).toHaveLength(9)
    const keys = result.ratios.map((r) => r.key).sort()
    expect(keys).toEqual(
      [
        'ap_turnover',
        'current_ratio',
        'days_inventory_outstanding',
        'debt_to_equity',
        'gross_margin_pct',
        'inventory_turnover',
        'net_profit_margin_pct',
        'quick_ratio',
        'return_on_assets'
      ].sort()
    )
  })

  it('status_color maps correctly to good warning danger neutral', async () => {
    jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    const result = await RatiosWidgetService.get(companyA._id.toString())

    const byKey = Object.fromEntries(result.ratios.map((r) => [r.key, r]))
    expect(byKey.current_ratio.status_color).toBe('#1D9E75')
    expect(byKey.quick_ratio.status_color).toBe('#EF9F27')
    expect(byKey.gross_margin_pct.status_color).toBe('#E24B4A')
    expect(byKey.inventory_turnover.status_color).toBe('#888780')
  })

  it('summary counts are correct', async () => {
    jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    const result = await RatiosWidgetService.get(companyA._id.toString())

    expect(result.summary).toEqual({
      good_count: 3,
      warning_count: 2,
      danger_count: 2,
      neutral_count: 2
    })
  })

  it('null ratio value has status neutral', async () => {
    jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(
      nineRatioPayload({
        current_ratio: {
          value: null,
          formula: 'Current Assets ÷ Current Liabilities',
          inputs: {},
          status: 'neutral'
        }
      })
    )

    const result = await RatiosWidgetService.get(companyA._id.toString())
    const cr = result.ratios.find((r) => r.key === 'current_ratio')
    expect(cr.value).toBeNull()
    expect(cr.status).toBe('neutral')
    expect(cr.status_color).toBe('#888780')
    expect(cr.status_label).toBe('N/A')
  })

  it('uses fiscal year start to today as date range', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2024, 2, 15, 12, 0, 0)))

    await Company.findByIdAndUpdate(companyA._id, { fiscal_year_start_month: 4 })

    const spy = jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    await RatiosWidgetService.get(companyA._id.toString())

    const fy = dateHelpers.currentFiscalYear(4)
    const expectedFrom = fy.start.toISOString().split('T')[0]
    const expectedTo = new Date().toISOString().split('T')[0]

    expect(spy).toHaveBeenCalledWith(
      companyA._id.toString(),
      expect.objectContaining({
        asOfDate: expectedTo,
        dateFrom: expectedFrom,
        dateTo: expectedTo
      })
    )
  })

  it('scoped to company', async () => {
    const spy = jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    await RatiosWidgetService.get(companyA._id.toString())

    expect(spy).toHaveBeenCalledWith(
      companyA._id.toString(),
      expect.any(Object)
    )
    expect(spy.mock.calls.some((c) => c[0] === companyB._id.toString())).toBe(false)
  })

  it('does not write to any collection', async () => {
    jest.spyOn(FinancialRatiosService, 'compute').mockResolvedValue(nineRatioPayload())

    const before = await Company.countDocuments()

    await RatiosWidgetService.get(companyA._id.toString())

    expect(await Company.countDocuments()).toBe(before)
  })
})
