const mongoose = require('mongoose')

const stockLevelSchema = new mongoose.Schema({

  company_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Company',
    required: true,
  },

  product_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Product',
    required: true,
  },

  warehouse_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Warehouse',
    required: true,
  },

  // ── QUANTITY FIELDS ────────────────────────────────────────────────

  qty_on_hand: {
    type:     Number,
    required: true,
    default:  0,
    min:      0
    // Physical units currently in this warehouse
    // Updated on: GRN confirm, delivery note confirm,
    //             stock transfer confirm, audit post,
    //             purchase return confirm, credit note confirm
  },

  qty_reserved: {
    type:    Number,
    default: 0,
    min:     0
    // Units reserved for confirmed sales invoices not yet delivered
    // Increases when: sales invoice confirmed
    // Decreases when: delivery note confirmed OR invoice cancelled
  },

  qty_on_order: {
    type:    Number,
    default: 0,
    min:     0
    // Units on approved but not yet received purchase orders
    // Increases when: PO approved
    // Decreases when: GRN confirmed (by received qty)
  },

  // qty_available is always computed — never stored
  // qty_available = qty_on_hand - qty_reserved
  // Use this virtual everywhere a dispatch check is needed

  // ── COST FIELDS ───────────────────────────────────────────────────

  avg_cost: {
    type:    Number,
    default: 0,
    min:     0
    // Weighted average cost per unit
    // Recalculated on every GRN confirmation (WAC method)
    // Formula: (old_qty × old_avg + recv_qty × recv_cost) / (old_qty + recv_qty)
    // For FIFO products: avg_cost is maintained for valuation reporting
    // but actual COGS uses StockLot costs — not this field
  },

  total_value: {
    type:    Number,
    default: 0
    // qty_on_hand × avg_cost
    // Updated whenever qty_on_hand or avg_cost changes
    // Used by inventory valuation report and balance sheet
  },

  // ── AUDIT / COUNT FIELDS ──────────────────────────────────────────

  last_counted_at: {
    type:    Date,
    default: null
    // Set when a stock audit is posted for this product/warehouse
  },

  last_counted_by: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null
  },

  last_movement_at: {
    type:    Date,
    default: null
    // Set on every stock movement — used to detect dead stock
  },

  last_movement_type: {
    type:    String,
    enum:    [
      'receipt',
      'dispatch',
      'transfer_in',
      'transfer_out',
      'adjustment_positive',
      'adjustment_negative',
      'return_in',
      'return_out',
      null
    ],
    default: null
  }

}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true }
})

// ── VIRTUAL ───────────────────────────────────────────────────────────

// Always computed — never stored in DB
// Use this everywhere you need to check available quantity
stockLevelSchema.virtual('qty_available').get(function () {
  return Math.max(0, this.qty_on_hand - this.qty_reserved)
})

// ── INDEXES ───────────────────────────────────────────────────────────

// Primary lookup — one record per product per warehouse per company
stockLevelSchema.index(
  { company_id: 1, product_id: 1, warehouse_id: 1 },
  { unique: true }
)

// Dashboard queries — stock value, warehouse breakdown
stockLevelSchema.index({ company_id: 1, warehouse_id: 1 })

// Low stock alert query
stockLevelSchema.index({ company_id: 1, qty_on_hand: 1 })

// Dead stock query — products with no recent movement
stockLevelSchema.index({ company_id: 1, last_movement_at: 1 })

// Valuation report
stockLevelSchema.index({ company_id: 1, product_id: 1 })

// ── PRE-SAVE HOOK ─────────────────────────────────────────────────────

// Keep total_value in sync whenever qty or cost changes
stockLevelSchema.pre('save', function (next) {
  this.total_value = Math.round(this.qty_on_hand * this.avg_cost * 100) / 100
  next()
})

stockLevelSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate()

  // If either qty_on_hand or avg_cost is being updated,
  // recompute total_value
  const qty  = update.$set?.qty_on_hand
  const cost = update.$set?.avg_cost

  if (qty !== undefined || cost !== undefined) {
    // We cannot access the full document here so we set a flag
    // The controller/service must pass both values when updating
    if (qty !== undefined && cost !== undefined) {
      update.$set.total_value = Math.round(qty * cost * 100) / 100
    }
  }

  next()
})

// ── STATIC METHODS ────────────────────────────────────────────────────

// Get or create a stock level record for a product/warehouse combination
// Called by StockService on every first receipt to a new location
stockLevelSchema.statics.getOrCreate = async function (companyId, productId, warehouseId) {
  const existing = await this.findOne({
    company_id:   companyId,
    product_id:   productId,
    warehouse_id: warehouseId
  })

  if (existing) return existing

  return this.create({
    company_id:   companyId,
    product_id:   productId,
    warehouse_id: warehouseId,
    qty_on_hand:  0,
    qty_reserved: 0,
    qty_on_order: 0,
    avg_cost:     0,
    total_value:  0
  })
}

// Recalculate WAC avg_cost after a receipt
// Call this inside the same transaction as the GRN confirmation
stockLevelSchema.statics.recalculateWAC = async function (
  companyId,
  productId,
  warehouseId,
  receivedQty,
  receivedCost,
  session = null
) {
  const level = await this.findOne({
    company_id:   companyId,
    product_id:   productId,
    warehouse_id: warehouseId
  }).session(session)

  if (!level) throw new Error('STOCK_LEVEL_NOT_FOUND')

  const oldQty   = level.qty_on_hand
  const oldAvg   = level.avg_cost
  const newQty   = oldQty + receivedQty
  const newAvg   = newQty > 0
    ? ((oldQty * oldAvg) + (receivedQty * receivedCost)) / newQty
    : receivedCost

  level.qty_on_hand    = Math.round(newQty * 10000) / 10000
  level.avg_cost       = Math.round(newAvg * 1000000) / 1000000
  level.total_value    = Math.round(level.qty_on_hand * level.avg_cost * 100) / 100
  level.last_movement_at   = new Date()
  level.last_movement_type = 'receipt'

  return level.save({ session })
}

// Validate there is enough available stock before any dispatch
// Call this BEFORE starting a transaction
stockLevelSchema.statics.validateAvailable = async function (
  companyId,
  productId,
  warehouseId,
  requiredQty
) {
  const level = await this.findOne({
    company_id:   companyId,
    product_id:   productId,
    warehouse_id: warehouseId
  }).lean()

  if (!level) {
    throw new Error(`STOCK_LEVEL_NOT_FOUND: No stock record for this product at this warehouse`)
  }

  const available = level.qty_on_hand - level.qty_reserved

  if (available < requiredQty) {
    throw new Error(
      `INSUFFICIENT_STOCK: Required ${requiredQty}, ` +
      `available ${Math.round(available * 10000) / 10000} ` +
      `(on hand ${level.qty_on_hand} minus reserved ${level.qty_reserved})`
    )
  }

  return true
}

// ── INSTANCE METHODS ──────────────────────────────────────────────────

// Apply a stock movement to this level record
// Called by StockService inside a MongoDB session
stockLevelSchema.methods.applyMovement = function (movementType, qty, unitCost = null) {

  const increase = ['receipt', 'transfer_in', 'adjustment_positive', 'return_in']
  const decrease = ['dispatch', 'transfer_out', 'adjustment_negative', 'return_out']

  if (increase.includes(movementType)) {
    this.qty_on_hand = Math.round((this.qty_on_hand + qty) * 10000) / 10000
  } else if (decrease.includes(movementType)) {
    this.qty_on_hand = Math.round((this.qty_on_hand - qty) * 10000) / 10000
    if (this.qty_on_hand < 0) {
      throw new Error(
        `STOCK_NEGATIVE: Movement would result in negative stock. ` +
        `Current: ${this.qty_on_hand + qty}, Removing: ${qty}`
      )
    }
  } else {
    throw new Error(`UNKNOWN_MOVEMENT_TYPE: ${movementType}`)
  }

  // Update total value
  this.total_value         = Math.round(this.qty_on_hand * this.avg_cost * 100) / 100
  this.last_movement_at    = new Date()
  this.last_movement_type  = movementType

  return this  // return this for chaining
}

// Reserve stock when a sales invoice is confirmed
stockLevelSchema.methods.reserve = function (qty) {
  const available = this.qty_on_hand - this.qty_reserved
  if (available < qty) {
    throw new Error(
      `INSUFFICIENT_STOCK: Cannot reserve ${qty}. ` +
      `Available: ${Math.round(available * 10000) / 10000}`
    )
  }
  this.qty_reserved = Math.round((this.qty_reserved + qty) * 10000) / 10000
  return this
}

// Release reservation when invoice is cancelled or delivery confirmed
stockLevelSchema.methods.releaseReservation = function (qty) {
  this.qty_reserved = Math.round(
    Math.max(0, this.qty_reserved - qty) * 10000
  ) / 10000
  return this
}

// Track quantity on order from approved POs
stockLevelSchema.methods.addOnOrder = function (qty) {
  this.qty_on_order = Math.round((this.qty_on_order + qty) * 10000) / 10000
  return this
}

stockLevelSchema.methods.reduceOnOrder = function (qty) {
  this.qty_on_order = Math.round(
    Math.max(0, this.qty_on_order - qty) * 10000
  ) / 10000
  return this
}

module.exports = mongoose.model('StockLevel', stockLevelSchema)