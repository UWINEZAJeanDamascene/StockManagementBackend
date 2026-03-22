const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const PeriodComparisonService = require('../../services/dashboards/PeriodComparisonService')
const ExecutiveDashboardService = require('../../services/dashboards/ExecutiveDashboardService')
const dashboardCache = require('../../services/DashboardCacheService')
const dateHelpers = require('../../utils/dateHelpers')
const ChartOfAccount = require('../../models/ChartOfAccount')
const JournalEntry = require('../../models/JournalEntry')
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

describe('PeriodComparisonService', () => {
  let companyA
  let companyB

  beforeEach(async () => {
    dashboardCache.clearAll()
    companyA = await Company.create({
      name: 'Company A',
      tin: 'TIN-A',
      email: 'company-a@test.com'
    })
    companyB = await Company.create({
      name: 'Company B',
      tin: 'TIN-B',
      email: 'company-b@test.com'
    })

    await ChartOfAccount.create({
      company: companyA._id,
      name: 'Sales Revenue',
      code: '4100',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true,
      allowDirectPosting: true
    })
    await ChartOfAccount.create({
      company: companyA._id,
      name: 'Rent Expense',
      code: '5100',
      type: 'expense',
      normal_balance: 'debit',
      isActive: true,
      allowDirectPosting: true
    })
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    jest.useRealTimers()
    await JournalEntry.deleteMany({})
    await ChartOfAccount.deleteMany({})
    await Company.deleteMany({})
    dashboardCache.clearAll()
  })

  it('current period covers first day of this month to today', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2024, 2, 15, 12, 0, 0)))

    const spy = jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockResolvedValue(0)

    const result = await PeriodComparisonService.get(companyA._id.toString())

    const expectedStart = new Date(Date.UTC(2024, 2, 1))
    const expectedEnd = new Date(Date.UTC(2024, 2, 15, 12, 0, 0))

    expect(result.periods.current.start.getTime()).toBe(expectedStart.getTime())
    expect(result.periods.current.end.getTime()).toBe(expectedEnd.getTime())

    const thisMonth = dateHelpers.currentMonth()
    expect(
      spy.mock.calls.some(
        (c) =>
          c[2].getTime() === thisMonth.start.getTime() &&
          c[3].getTime() === thisMonth.end.getTime()
      )
    ).toBe(true)
  })

  it('previous period covers first to last day of last month', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2024, 2, 15, 12, 0, 0)))

    const spy = jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockResolvedValue(0)

    await PeriodComparisonService.get(companyA._id.toString())

    const lastMonth = dateHelpers.previousMonth()
    expect(
      spy.mock.calls.some(
        (c) =>
          c[2].getTime() === lastMonth.start.getTime() &&
          c[3].getTime() === lastMonth.end.getTime()
      )
    ).toBe(true)
  })

  it('same_month_last_year covers the same month 12 months ago', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2024, 2, 15, 12, 0, 0)))

    const spy = jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockResolvedValue(0)

    const result = await PeriodComparisonService.get(companyA._id.toString())

    const sm = dateHelpers.sameMonthLastYear()
    expect(result.periods.same_month_last_year.start.getTime()).toBe(sm.start.getTime())
    expect(result.periods.same_month_last_year.end.getTime()).toBe(sm.end.getTime())

    expect(
      spy.mock.calls.some(
        (c) =>
          c[2].getTime() === sm.start.getTime() && c[3].getTime() === sm.end.getTime()
      )
    ).toBe(true)
  })

  it('revenue_vs_last_month = (current - previous) / previous × 100', async () => {
    jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockImplementation(
      async (companyId, accountType, dateFrom, dateTo) => {
        const tm = dateHelpers.currentMonth()
        const lm = dateHelpers.previousMonth()
        const sm = dateHelpers.sameMonthLastYear()
        const same = (a, b) => a.getTime() === b.getTime()
        if (accountType === 'revenue') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 120
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 100
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 40
        }
        if (accountType === 'expense') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 10
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 10
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 10
        }
        return 0
      }
    )

    const result = await PeriodComparisonService.get(companyA._id.toString())
    expect(result.changes.revenue_vs_last_month).toBe(20)
  })

  it('revenue_vs_last_year = (current - last_year) / last_year × 100', async () => {
    jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockImplementation(
      async (companyId, accountType, dateFrom, dateTo) => {
        const tm = dateHelpers.currentMonth()
        const lm = dateHelpers.previousMonth()
        const sm = dateHelpers.sameMonthLastYear()
        const same = (a, b) => a.getTime() === b.getTime()
        if (accountType === 'revenue') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 150
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 0
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 50
        }
        if (accountType === 'expense') return 0
        return 0
      }
    )

    const result = await PeriodComparisonService.get(companyA._id.toString())
    expect(result.changes.revenue_vs_last_year).toBe(200)
  })

  it('percentage_change is null when previous period is zero', async () => {
    jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockImplementation(
      async (companyId, accountType, dateFrom, dateTo) => {
        const tm = dateHelpers.currentMonth()
        const lm = dateHelpers.previousMonth()
        const sm = dateHelpers.sameMonthLastYear()
        const same = (a, b) => a.getTime() === b.getTime()
        if (accountType === 'revenue') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 100
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 0
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 0
        }
        if (accountType === 'expense') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 20
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 0
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 0
        }
        return 0
      }
    )

    const result = await PeriodComparisonService.get(companyA._id.toString())
    expect(result.changes.revenue_vs_last_month).toBeNull()
    expect(result.changes.expenses_vs_last_month).toBeNull()
    expect(result.changes.net_profit_vs_last_month).toBeNull()
    expect(result.changes.revenue_vs_last_year).toBeNull()
    expect(result.changes.expenses_vs_last_year).toBeNull()
    expect(result.changes.net_profit_vs_last_year).toBeNull()
  })

  it('net_profit = revenue - expenses for each period', async () => {
    jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockImplementation(
      async (companyId, accountType, dateFrom, dateTo) => {
        const tm = dateHelpers.currentMonth()
        const lm = dateHelpers.previousMonth()
        const sm = dateHelpers.sameMonthLastYear()
        const same = (a, b) => a.getTime() === b.getTime()
        if (accountType === 'revenue') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 300
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 200
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 100
        }
        if (accountType === 'expense') {
          if (same(dateFrom, tm.start) && same(dateTo, tm.end)) return 100
          if (same(dateFrom, lm.start) && same(dateTo, lm.end)) return 50
          if (same(dateFrom, sm.start) && same(dateTo, sm.end)) return 25
        }
        return 0
      }
    )

    const result = await PeriodComparisonService.get(companyA._id.toString())

    expect(result.periods.current.metrics.net_profit).toBe(200)
    expect(result.periods.current.metrics.revenue).toBe(300)
    expect(result.periods.current.metrics.expenses).toBe(100)

    expect(result.periods.previous.metrics.net_profit).toBe(150)
    expect(result.periods.same_month_last_year.metrics.net_profit).toBe(75)
  })

  it('scoped to company', async () => {
    await ChartOfAccount.create({
      company: companyB._id,
      name: 'Sales Revenue B',
      code: '4100',
      type: 'revenue',
      normal_balance: 'credit',
      isActive: true,
      allowDirectPosting: true
    })
    await ChartOfAccount.create({
      company: companyB._id,
      name: 'Rent B',
      code: '5100',
      type: 'expense',
      normal_balance: 'debit',
      isActive: true,
      allowDirectPosting: true
    })

    const currentDate = new Date()
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)

    await JournalEntry.create({
      company: companyB._id,
      entryNumber: 'JE-B',
      date: startOfMonth,
      description: 'B revenue',
      status: 'posted',
      lines: [
        { accountCode: '1000', accountName: 'Cash', debit: 9999, credit: 0 },
        { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 9999 }
      ]
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-A',
      date: startOfMonth,
      description: 'A revenue',
      status: 'posted',
      lines: [
        { accountCode: '1000', accountName: 'Cash', debit: 50, credit: 0 },
        { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 50 }
      ]
    })

    const result = await PeriodComparisonService.get(companyA._id.toString())
    expect(result.periods.current.metrics.revenue).toBe(50)
  })

  it('does not write to any collection', async () => {
    const initialJournal = await JournalEntry.countDocuments()
    const initialCoa = await ChartOfAccount.countDocuments()

    await PeriodComparisonService.get(companyA._id.toString())

    expect(await JournalEntry.countDocuments()).toBe(initialJournal)
    expect(await ChartOfAccount.countDocuments()).toBe(initialCoa)
  })

  it('completes in under 500ms', async () => {
    jest.spyOn(ExecutiveDashboardService, '_getAccountTypeTotal').mockResolvedValue(0)

    const start = Date.now()
    await PeriodComparisonService.get(companyA._id.toString())
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(500)
  })
})
