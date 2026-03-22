const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const FinanceDashboardService = require('../../services/dashboards/FinanceDashboardService')
const dashboardCache = require('../../services/DashboardCacheService')
const BankAccount = require('../../models/BankAccount')
const JournalEntry = require('../../models/JournalEntry')
const Company = require('../../models/Company')
const User = require('../../models/User')
const ChartOfAccount = require('../../models/ChartOfAccount')
const Budget = require('../../models/Budget')
const BudgetLine = require('../../models/BudgetLine')
const GoodsReceivedNote = require('../../models/GoodsReceivedNote')
const PurchaseOrder = require('../../models/PurchaseOrder')
const Warehouse = require('../../models/Warehouse')
const Product = require('../../models/Product')
const Category = require('../../models/Category')
const Supplier = require('../../models/Supplier')

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

async function createUser(companyId) {
  return User.create({
    name: 'Finance Test User',
    email: `fin-${new mongoose.Types.ObjectId()}@test.com`,
    password: 'password123',
    company: companyId,
    role: 'admin'
  })
}

describe('FinanceDashboardService', () => {
  let companyA
  let companyB
  let userA

  beforeEach(async () => {
    dashboardCache.clearAll()
    const suffix = new mongoose.Types.ObjectId().toString()
    companyA = await Company.create({
      name: 'Finance Co A',
      code: `FA${suffix}`,
      email: `fa-${suffix}@test.com`
    })
    companyB = await Company.create({
      name: 'Finance Co B',
      code: `FB${suffix}`,
      email: `fb-${suffix}@test.com`
    })
    userA = await createUser(companyA._id)
  })

  afterEach(async () => {
    await JournalEntry.deleteMany({})
    await BankAccount.deleteMany({})
    await BudgetLine.deleteMany({})
    await Budget.deleteMany({})
    await ChartOfAccount.deleteMany({})
    await GoodsReceivedNote.deleteMany({})
    await PurchaseOrder.deleteMany({})
    await Product.deleteMany({})
    await Category.deleteMany({})
    await Warehouse.deleteMany({})
    await Supplier.deleteMany({})
    await User.deleteMany({})
    await Company.deleteMany({})
    dashboardCache.clearAll()
  })

  it('exposes summary and date_context for dashboard consumers', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'Main',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('100.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())

    expect(result.summary.total_bank_balance).toBe(100)
    expect(result.summary.upcoming_ap_count).toBe(0)
    expect(typeof result.summary.net_cash_flow_30d).toBe('number')
    expect(result.date_context.current_month_start).toBeInstanceOf(Date)
    expect(result.date_context.cash_flow_period_start).toBeInstanceOf(Date)
    expect(result.cash_flow_30_days.period_start).toBeDefined()
    expect(result.cash_flow_30_days.by_source).toEqual([])
  })

  it('bank_balance = opening_balance + SUM(DR journal lines) - SUM(CR journal lines) per account', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'Main',
      accountNumber: 'ACC1',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('1000.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-001',
      date: new Date(),
      description: 'Deposit',
      status: 'posted',
      createdBy: userA._id,
      lines: [
        { accountCode: '1100', accountName: 'Bank', debit: 200, credit: 0 },
        { accountCode: '4100', accountName: 'Revenue', debit: 0, credit: 200 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.bank_balances.accounts[0].opening_balance).toBe(1000)
    expect(result.bank_balances.accounts[0].current_balance).toBe(1200)
  })

  it('total_balance = sum of all individual bank account balances', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'B1',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('500.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })
    await BankAccount.create({
      company: companyA._id,
      name: 'B2',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('700.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1101'
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.bank_balances.total_balance).toBe(1200)
  })

  it('upcoming_payments only includes items due within daysAhead window', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 10, 12, 0, 0)))

    const wh = await Warehouse.create({
      company: companyA._id,
      name: 'W',
      code: 'W1',
      isActive: true
    })
    const cat = await Category.create({ company: companyA._id, name: 'C' })
    const product = await Product.create({
      company: companyA._id,
      name: 'P',
      sku: 'SKU1',
      category: cat._id,
      unit: 'pcs',
      currentStock: 10,
      isActive: true,
      averageCost: 1,
      sellingPrice: 2,
      costingMethod: 'fifo'
    })
    const supplier = await Supplier.create({
      company: companyA._id,
      name: 'S',
      code: 'S1',
      contact: { email: 's@test.com' }
    })
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-F-001',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      currencyCode: 'USD',
      lines: [
        {
          product: product._id,
          qtyOrdered: 10,
          qtyReceived: 10,
          unitCost: 10,
          taxRate: 0,
          lineTotal: 100
        }
      ],
      subtotal: 100,
      taxAmount: 0,
      totalAmount: 100
    })

    const inWindow = new Date(Date.UTC(2025, 5, 20))
    const outWindow = new Date(Date.UTC(2025, 6, 25))

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-IN',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('100.00'),
      amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
      paymentStatus: 'pending',
      paymentDueDate: inWindow,
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 100 }]
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-OUT',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('200.00'),
      amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
      paymentStatus: 'pending',
      paymentDueDate: outWindow,
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 200 }]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.upcoming_payments.count).toBe(1)
    expect(result.upcoming_payments.total).toBe(100)
    expect(result.upcoming_payments.items[0].reference).toBe('GRN-IN')

    jest.useRealTimers()
  })

  it('upcoming_payments sorted by due_date ascending', async () => {
    const wh = await Warehouse.create({
      company: companyA._id,
      name: 'W',
      code: 'W2',
      isActive: true
    })
    const cat = await Category.create({ company: companyA._id, name: 'C2' })
    const product = await Product.create({
      company: companyA._id,
      name: 'P2',
      sku: 'SKU2',
      category: cat._id,
      unit: 'pcs',
      currentStock: 10,
      isActive: true,
      averageCost: 1,
      sellingPrice: 2,
      costingMethod: 'fifo'
    })
    const supplier = await Supplier.create({
      company: companyA._id,
      name: 'S2',
      code: 'S2',
      contact: { email: 's2@test.com' }
    })
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-F-002',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      currencyCode: 'USD',
      lines: [
        {
          product: product._id,
          qtyOrdered: 10,
          qtyReceived: 10,
          unitCost: 10,
          taxRate: 0,
          lineTotal: 100
        }
      ],
      subtotal: 100,
      taxAmount: 0,
      totalAmount: 100
    })

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const d1 = new Date(today)
    d1.setUTCDate(d1.getUTCDate() + 3)
    const d2 = new Date(today)
    d2.setUTCDate(d2.getUTCDate() + 10)

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-LATE',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('50.00'),
      amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
      paymentStatus: 'pending',
      paymentDueDate: d2,
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 50 }]
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-EARLY',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('30.00'),
      amountPaid: mongoose.Types.Decimal128.fromString('0.00'),
      paymentStatus: 'pending',
      paymentDueDate: d1,
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 30 }]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.upcoming_payments.items.map((i) => i.reference)).toEqual(['GRN-EARLY', 'GRN-LATE'])
  })

  it('budget_vs_actual returns has_budget false when no approved budget exists', async () => {
    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.budget_vs_actual.has_budget).toBe(false)
  })

  it('variance = budgeted_amount - actual_amount', async () => {
    const expense = await ChartOfAccount.create({
      company: companyA._id,
      code: '5100',
      name: 'Expense',
      type: 'expense',
      normal_balance: 'debit',
      isActive: true
    })

    const budget = await Budget.create({
      company_id: companyA._id,
      name: 'Main',
      fiscal_year: new Date().getUTCFullYear(),
      status: 'approved',
      created_by: userA._id
    })

    await BudgetLine.create({
      company_id: companyA._id,
      budget_id: budget._id,
      account_id: expense._id,
      period_month: new Date().getUTCMonth() + 1,
      period_year: new Date().getUTCFullYear(),
      budgeted_amount: mongoose.Types.Decimal128.fromString('1000.00')
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-B',
      date: new Date(),
      description: 'Spend',
      status: 'posted',
      createdBy: userA._id,
      lines: [
        { accountCode: '5100', accountName: 'Rent', debit: 400, credit: 0 },
        { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 400 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.budget_vs_actual.has_budget).toBe(true)
    expect(result.budget_vs_actual.lines[0].budgeted_amount).toBe(1000)
    expect(result.budget_vs_actual.lines[0].actual_amount).toBe(400)
    expect(result.budget_vs_actual.lines[0].variance).toBe(600)
  })

  it('status is over_budget when actual exceeds budgeted', async () => {
    const expense = await ChartOfAccount.create({
      company: companyA._id,
      code: '5200',
      name: 'Expense',
      type: 'expense',
      normal_balance: 'debit',
      isActive: true
    })

    const budget = await Budget.create({
      company_id: companyA._id,
      name: 'Main',
      fiscal_year: new Date().getUTCFullYear(),
      status: 'approved',
      created_by: userA._id
    })

    await BudgetLine.create({
      company_id: companyA._id,
      budget_id: budget._id,
      account_id: expense._id,
      period_month: new Date().getUTCMonth() + 1,
      period_year: new Date().getUTCFullYear(),
      budgeted_amount: mongoose.Types.Decimal128.fromString('100.00')
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-O',
      date: new Date(),
      description: 'Over',
      status: 'posted',
      createdBy: userA._id,
      lines: [
        { accountCode: '5200', accountName: 'E', debit: 150, credit: 0 },
        { accountCode: '1100', accountName: 'Cash', debit: 0, credit: 150 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.budget_vs_actual.lines[0].status).toBe('over_budget')
    expect(result.budget_vs_actual.over_budget).toBe(true)
  })

  it('net_vat_payable = output_vat - input_vat from tax account balances', async () => {
    await ChartOfAccount.create({
      company: companyA._id,
      code: '2300',
      name: 'VAT',
      type: 'liability',
      subtype: 'tax',
      normal_balance: 'credit',
      isActive: true
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-V',
      date: new Date(),
      description: 'VAT',
      status: 'posted',
      createdBy: userA._id,
      lines: [
        { accountCode: '2300', accountName: 'VAT', debit: 20, credit: 100 },
        { accountCode: '1100', accountName: 'Bank', debit: 80, credit: 0 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.tax_liability.output_vat).toBe(100)
    expect(result.tax_liability.input_vat).toBe(20)
    expect(result.tax_liability.net_vat_payable).toBe(80)
  })

  it('cash_flow_30_days inflows come from ar_receipt source_type only', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'Cash',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('0'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-AR',
      date: new Date(),
      description: 'Receipt',
      status: 'posted',
      sourceType: 'ar_receipt',
      createdBy: userA._id,
      lines: [
        { accountCode: '1100', accountName: 'Bank', debit: 200, credit: 0 },
        { accountCode: '1200', accountName: 'AR', debit: 0, credit: 200 }
      ]
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-M',
      date: new Date(),
      description: 'Manual',
      status: 'posted',
      sourceType: 'manual',
      createdBy: userA._id,
      lines: [
        { accountCode: '1100', accountName: 'Bank', debit: 999, credit: 0 },
        { accountCode: '4100', accountName: 'Rev', debit: 0, credit: 999 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.cash_flow_30_days.inflows).toBe(200)
  })

  it('cash_flow_30_days outflows come from ap_payment payroll_run expense source_types', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'Cash',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('0'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-AP',
      date: new Date(),
      description: 'AP',
      status: 'posted',
      sourceType: 'ap_payment',
      createdBy: userA._id,
      lines: [
        { accountCode: '2100', accountName: 'AP', debit: 40, credit: 0 },
        { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 40 }
      ]
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-PR',
      date: new Date(),
      description: 'Payroll',
      status: 'posted',
      sourceType: 'payroll_run',
      createdBy: userA._id,
      lines: [
        { accountCode: '5100', accountName: 'Payroll exp', debit: 10, credit: 0 },
        { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 10 }
      ]
    })

    await JournalEntry.create({
      company: companyA._id,
      entryNumber: 'JE-EX',
      date: new Date(),
      description: 'Exp',
      status: 'posted',
      sourceType: 'expense',
      createdBy: userA._id,
      lines: [
        { accountCode: '5200', accountName: 'Misc', debit: 5, credit: 0 },
        { accountCode: '1100', accountName: 'Bank', debit: 0, credit: 5 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.cash_flow_30_days.outflows).toBe(55)
  })

  it('scoped to company — company B data never appears', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'A',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('50.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    const userB = await createUser(companyB._id)
    await BankAccount.create({
      company: companyB._id,
      name: 'B',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('99999.00'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    await JournalEntry.create({
      company: companyB._id,
      entryNumber: 'JE-B',
      date: new Date(),
      description: 'X',
      status: 'posted',
      createdBy: userB._id,
      lines: [
        { accountCode: '1100', accountName: 'Bank', debit: 5000, credit: 0 },
        { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 5000 }
      ]
    })

    const result = await FinanceDashboardService.get(companyA._id.toString())
    expect(result.bank_balances.accounts).toHaveLength(1)
    expect(result.bank_balances.accounts[0].bank_name).toBe('A')
    expect(result.bank_balances.total_balance).toBe(50)
  })

  it('does not write to any collection', async () => {
    await BankAccount.create({
      company: companyA._id,
      name: 'Main',
      currencyCode: 'USD',
      openingBalance: mongoose.Types.Decimal128.fromString('0'),
      openingBalanceDate: new Date(),
      isActive: true,
      ledgerAccountId: '1100'
    })

    const before = await JournalEntry.countDocuments()
    await FinanceDashboardService.get(companyA._id.toString())
    expect(await JournalEntry.countDocuments()).toBe(before)
  })
})
