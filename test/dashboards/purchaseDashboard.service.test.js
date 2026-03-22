const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const PurchaseDashboardService = require('../../services/dashboards/PurchaseDashboardService')
const dashboardCache = require('../../services/DashboardCacheService')
const PurchaseOrder = require('../../models/PurchaseOrder')
const GoodsReceivedNote = require('../../models/GoodsReceivedNote')
const Company = require('../../models/Company')
const Warehouse = require('../../models/Warehouse')
const Category = require('../../models/Category')
const Product = require('../../models/Product')
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

async function seedPurchaseFixture(companyId) {
  const wh = await Warehouse.create({
    company: companyId,
    name: 'WH',
    code: `WH${Date.now()}`,
    isActive: true
  })
  const cat = await Category.create({ company: companyId, name: 'Cat' })
  const product = await Product.create({
    company: companyId,
    name: 'P',
    sku: `SKU${Date.now()}`,
    category: cat._id,
    unit: 'pcs',
    currentStock: 100,
    isActive: true,
    averageCost: 10,
    sellingPrice: 20,
    costingMethod: 'fifo'
  })
  const supplier = await Supplier.create({
    company: companyId,
    name: 'Sup',
    code: `S${Date.now()}`,
    contact: { email: 's@test.com' }
  })
  return { wh, product, supplier }
}

describe('PurchaseDashboardService', () => {
  let companyA
  let companyB

  beforeEach(async () => {
    dashboardCache.clearAll()
    const suffix = new mongoose.Types.ObjectId().toString()
    companyA = await Company.create({
      name: 'Pur A',
      code: `PA${suffix}`,
      email: `pa-${suffix}@test.com`
    })
    companyB = await Company.create({
      name: 'Pur B',
      code: `PB${suffix}`,
      email: `pb-${suffix}@test.com`
    })
  })

  afterEach(async () => {
    await GoodsReceivedNote.deleteMany({})
    await PurchaseOrder.deleteMany({})
    await Product.deleteMany({})
    await Category.deleteMany({})
    await Warehouse.deleteMany({})
    await Supplier.deleteMany({})
    await Company.deleteMany({})
    dashboardCache.clearAll()
  })

  it('po_open_count includes only draft and approved POs', async () => {
    const { wh, supplier } = await seedPurchaseFixture(companyA._id)

    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-D',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'draft',
      totalAmount: 100,
      lines: []
    })
    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-A',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 200,
      lines: []
    })
    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-PR',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'partially_received',
      totalAmount: 400,
      lines: []
    })
    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-C',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'cancelled',
      totalAmount: 999,
      lines: []
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.purchase_orders.open_count).toBe(2)
    expect(result.purchase_orders.open_value).toBe(300)
    expect(result.by_status_list).toHaveLength(5)
    expect(result.by_status_list.find((x) => x.status === 'draft').count).toBe(1)
    expect(result.by_status.cancelled.count).toBe(1)
  })

  it('grn_pending includes only confirmed GRNs with pending or partially_paid status', async () => {
    const { wh, product, supplier } = await seedPurchaseFixture(companyA._id)

    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-GRN',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 1000,
      lines: []
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-P',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      totalAmount: mongoose.Types.Decimal128.fromString('100.00'),
      balance: mongoose.Types.Decimal128.fromString('100.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 100 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-PP',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      totalAmount: mongoose.Types.Decimal128.fromString('50.00'),
      balance: mongoose.Types.Decimal128.fromString('20.00'),
      paymentStatus: 'partially_paid',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 50 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-PAID',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      totalAmount: mongoose.Types.Decimal128.fromString('999.00'),
      balance: mongoose.Types.Decimal128.fromString('0.00'),
      paymentStatus: 'paid',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 999 }]
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.grn_pending.count).toBe(2)
    expect(result.grn_pending.total_value).toBe(150)
    expect(result.grn_pending.total_balance_outstanding).toBe(120)
    expect(result.summary.grn_pending_balance).toBe(120)
  })

  it('ap_total_outstanding equals sum of balance on unpaid GRNs', async () => {
    const { wh, product, supplier } = await seedPurchaseFixture(companyA._id)
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-AP',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 500,
      lines: []
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-AP1',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('75.50'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 75 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-AP2',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('24.50'),
      paymentStatus: 'partially_paid',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 24 }]
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.accounts_payable.total_outstanding).toBe(100)
    expect(result.accounts_payable.invoice_count).toBe(2)
  })

  it('ap_overdue_amount includes only GRNs where payment_due_date < today', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 15, 12, 0, 0)))

    const { wh, product, supplier } = await seedPurchaseFixture(companyA._id)
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-OD',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 500,
      lines: []
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-FUT',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('10.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(Date.UTC(2025, 5, 20)),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 10 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'GRN-PAST',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('40.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(Date.UTC(2025, 5, 10)),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 40 }]
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.accounts_payable.overdue_amount).toBe(40)
    expect(result.accounts_payable.overdue_count).toBe(1)

    jest.useRealTimers()
  })

  it('ap_aging buckets are mutually exclusive and sum to total_outstanding', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.setSystemTime(new Date(Date.UTC(2025, 5, 15, 12, 0, 0)))

    const { wh, product, supplier } = await seedPurchaseFixture(companyA._id)
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-AG',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 500,
      lines: []
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'G-ND',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('100.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(Date.UTC(2025, 5, 25)),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 100 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'G-130',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('50.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(Date.UTC(2025, 5, 10)),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 50 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'G-90P',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      balance: mongoose.Types.Decimal128.fromString('25.00'),
      paymentStatus: 'pending',
      paymentDueDate: new Date(Date.UTC(2025, 2, 1)),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 25 }]
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    const a = result.ap_aging
    const bucketSum =
      a.not_due + a.days_1_30 + a.days_31_60 + a.days_61_90 + a.days_90_plus
    expect(bucketSum).toBeCloseTo(a.total_outstanding, 2)
    expect(a.total_outstanding).toBeCloseTo(result.accounts_payable.total_outstanding, 2)

    jest.useRealTimers()
  })

  it('top_suppliers sorted by total_value descending', async () => {
    const { wh, product, supplier } = await seedPurchaseFixture(companyA._id)
    const po = await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-TS',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'approved',
      totalAmount: 5000,
      lines: []
    })

    const sup2 = await Supplier.create({
      company: companyA._id,
      name: 'Small',
      code: `S2${Date.now()}`,
      contact: { email: 's2@test.com' }
    })

    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'G-BIG',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: supplier._id,
      status: 'confirmed',
      totalAmount: mongoose.Types.Decimal128.fromString('500.00'),
      balance: mongoose.Types.Decimal128.fromString('0'),
      paymentStatus: 'paid',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 500 }]
    })
    await GoodsReceivedNote.create({
      company: companyA._id,
      referenceNo: 'G-SM1',
      purchaseOrder: po._id,
      warehouse: wh._id,
      supplier: sup2._id,
      status: 'confirmed',
      totalAmount: mongoose.Types.Decimal128.fromString('50.00'),
      balance: mongoose.Types.Decimal128.fromString('0'),
      paymentStatus: 'paid',
      paymentDueDate: new Date(),
      lines: [{ product: product._id, qtyReceived: 1, unitCost: 50 }]
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.top_suppliers[0].total_value).toBeGreaterThanOrEqual(result.top_suppliers[1].total_value)
    expect(result.top_suppliers[0].supplier_name).toBe('Sup')
  })

  it('scoped to company — company B POs never appear', async () => {
    const fxA = await seedPurchaseFixture(companyA._id)
    const fxB = await seedPurchaseFixture(companyB._id)

    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-AONLY',
      supplier: fxA.supplier._id,
      warehouse: fxA.wh._id,
      orderDate: new Date(),
      status: 'draft',
      totalAmount: 10,
      lines: []
    })
    await PurchaseOrder.create({
      company: companyB._id,
      referenceNo: 'PO-BONLY',
      supplier: fxB.supplier._id,
      warehouse: fxB.wh._id,
      orderDate: new Date(),
      status: 'draft',
      totalAmount: 99999,
      lines: []
    })

    const result = await PurchaseDashboardService.get(companyA._id.toString())
    expect(result.purchase_orders.po_count).toBe(1)
    expect(result.purchase_orders.total_value).toBe(10)
  })

  it('does not write to any collection', async () => {
    const { wh, supplier } = await seedPurchaseFixture(companyA._id)
    await PurchaseOrder.create({
      company: companyA._id,
      referenceNo: 'PO-R',
      supplier: supplier._id,
      warehouse: wh._id,
      orderDate: new Date(),
      status: 'draft',
      totalAmount: 1,
      lines: []
    })

    const before = await PurchaseOrder.countDocuments()
    await PurchaseDashboardService.get(companyA._id.toString())
    expect(await PurchaseOrder.countDocuments()).toBe(before)
  })
})
