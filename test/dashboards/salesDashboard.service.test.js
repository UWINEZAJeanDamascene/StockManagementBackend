const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const SalesDashboardService = require('../../services/dashboards/SalesDashboardService')
const dashboardCache = require('../../services/DashboardCacheService')
const Invoice = require('../../models/Invoice')
const CreditNote = require('../../models/CreditNote')
const Company = require('../../models/Company')
const Client = require('../../models/Client')
const User = require('../../models/User')

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

/** Line totals must match asserted invoice amounts — Invoice pre-save recomputes totals from lines. */
function line(productId, unitPrice = 100) {
  return {
    product: productId,
    description: 'Item',
    qty: 1,
    unitPrice,
    taxRate: 0,
    lineTotal: unitPrice
  }
}

describe('SalesDashboardService', () => {
  let companyA
  let companyB
  let clientA
  let clientB
  let userA
  const productId = () => new mongoose.Types.ObjectId()
  const invRef = () => `INV-${new mongoose.Types.ObjectId()}`

  beforeEach(async () => {
    dashboardCache.clearAll()
    const suffix = new mongoose.Types.ObjectId().toString()
    companyA = await Company.create({
      name: 'Sales A',
      code: `SA${suffix}`,
      email: `sa-${suffix}@test.com`
    })
    companyB = await Company.create({
      name: 'Sales B',
      code: `SB${suffix}`,
      email: `sb-${suffix}@test.com`
    })
    clientA = await Client.create({
      company: companyA._id,
      name: 'Client A',
      code: `CA${suffix}`
    })
    clientB = await Client.create({
      company: companyB._id,
      name: 'Client B',
      code: `CB${suffix}`
    })
    userA = await User.create({
      name: 'U',
      email: `u-${suffix}@test.com`,
      password: 'password123',
      company: companyA._id,
      role: 'admin'
    })
  })

  afterEach(async () => {
    jest.useRealTimers()
    await CreditNote.deleteMany({})
    await Invoice.deleteMany({})
    await User.deleteMany({})
    await Client.deleteMany({})
    await Company.deleteMany({})
    dashboardCache.clearAll()
  })

  it('total_invoiced equals sum of total_amount on invoices in current month', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 100,
      amountPaid: 0,
      amountOutstanding: 100,
      lines: [line(productId(), 100)]
    })
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 200,
      amountPaid: 0,
      amountOutstanding: 200,
      lines: [line(productId(), 200)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.invoices.total_invoiced).toBe(300)
    expect(result.invoices.invoices_raised).toBe(2)
  })

  it('total_collected equals sum of amount_paid on invoices in current month', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'partially_paid',
      totalAmount: 200,
      amountPaid: 75,
      amountOutstanding: 125,
      lines: [line(productId(), 200)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.invoices.total_collected).toBe(75)
  })

  it('ar_aging not_due includes invoices where due_date >= today', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 15, 12, 0, 0)))

    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(Date.UTC(2025, 5, 20)),
      status: 'confirmed',
      totalAmount: 100,
      amountPaid: 0,
      amountOutstanding: 100,
      lines: [line(productId(), 100)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.ar_aging.not_due).toBe(100)

    jest.useRealTimers()
  })

  it('ar_aging days_1_30 includes invoices 1 to 30 days past due_date', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 15, 12, 0, 0)))

    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(Date.UTC(2025, 5, 10)),
      status: 'confirmed',
      totalAmount: 40,
      amountPaid: 0,
      amountOutstanding: 40,
      lines: [line(productId(), 40)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.ar_aging.days_1_30).toBe(40)

    jest.useRealTimers()
  })

  it('ar_aging days_90_plus includes invoices more than 90 days past due_date', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 15, 12, 0, 0)))

    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(Date.UTC(2025, 2, 1)),
      status: 'confirmed',
      totalAmount: 25,
      amountPaid: 0,
      amountOutstanding: 25,
      lines: [line(productId(), 25)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.ar_aging.days_90_plus).toBe(25)

    jest.useRealTimers()
  })

  it('top_clients sorted by total_invoiced descending', async () => {
    const cSmall = await Client.create({
      company: companyA._id,
      name: 'Small',
      code: `CS${Date.now()}`
    })

    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 500,
      amountPaid: 500,
      amountOutstanding: 0,
      lines: [line(productId(), 500)]
    })
    await Invoice.create({
      company: companyA._id,
      client: cSmall._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 50,
      amountPaid: 0,
      amountOutstanding: 50,
      lines: [line(productId(), 50)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.top_clients[0].total_invoiced).toBeGreaterThanOrEqual(result.top_clients[1].total_invoiced)
    expect(result.top_clients[0].client_name).toBe('Client A')
  })

  it('collection_rate_pct = (amount_paid / total_amount) × 100', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 300,
      amountPaid: 150,
      amountOutstanding: 150,
      lines: [line(productId(), 300)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.collection_rate.collection_rate_pct).toBe(50)
    expect(result.collection_rate.total_billed).toBe(300)
    expect(result.collection_rate.total_collected).toBe(150)
  })

  it('collection_rate_pct is 0 not null when total_billed is zero', async () => {
    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.collection_rate.collection_rate_pct).toBe(0)
    expect(result.collection_rate.total_billed).toBe(0)
  })

  it('credit_notes_summary only includes confirmed credit notes', async () => {
    const inv = await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 1000,
      amountPaid: 1000,
      amountOutstanding: 0,
      lines: [line(productId(), 1000)]
    })

    await CreditNote.create({
      company: companyA._id,
      invoice: inv._id,
      client: clientA._id,
      referenceNo: `CN-D-${new mongoose.Types.ObjectId()}`,
      creditDate: new Date(),
      reason: 'Test',
      type: 'price_adjustment',
      status: 'draft',
      totalAmount: 999,
      createdBy: userA._id,
      currencyCode: 'USD'
    })
    await CreditNote.create({
      company: companyA._id,
      invoice: inv._id,
      client: clientA._id,
      referenceNo: `CN-C-${new mongoose.Types.ObjectId()}`,
      creditDate: new Date(),
      reason: 'Test',
      type: 'price_adjustment',
      status: 'confirmed',
      totalAmount: 40,
      createdBy: userA._id,
      currencyCode: 'USD'
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.credit_notes.count).toBe(1)
    expect(result.credit_notes.total_value).toBe(40)
  })

  it('draft invoices excluded from invoices_raised count', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'draft',
      totalAmount: 9999,
      amountPaid: 0,
      amountOutstanding: 9999,
      lines: [line(productId(), 9999)]
    })
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 10,
      amountPaid: 0,
      amountOutstanding: 10,
      lines: [line(productId(), 10)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.invoices.invoices_raised).toBe(1)
    expect(result.invoices.total_invoiced).toBe(10)
  })

  it('scoped to company — company B invoices never appear', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 10,
      amountPaid: 0,
      amountOutstanding: 10,
      lines: [line(productId(), 10)]
    })
    await Invoice.create({
      company: companyB._id,
      client: clientB._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 88888,
      amountPaid: 0,
      amountOutstanding: 88888,
      lines: [line(productId(), 88888)]
    })

    const result = await SalesDashboardService.get(companyA._id.toString())
    expect(result.invoices.total_invoiced).toBe(10)
  })

  it('does not write to any collection', async () => {
    await Invoice.create({
      company: companyA._id,
      client: clientA._id,
      referenceNo: invRef(),
      invoiceDate: new Date(),
      dueDate: new Date(),
      status: 'confirmed',
      totalAmount: 1,
      amountPaid: 1,
      amountOutstanding: 0,
      lines: [line(productId(), 1)]
    })

    const before = await Invoice.countDocuments()
    await SalesDashboardService.get(companyA._id.toString())
    expect(await Invoice.countDocuments()).toBe(before)
  })
})
