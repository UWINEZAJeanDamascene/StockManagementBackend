const mongoose = require('mongoose');

const inventoryBatchSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Inventory batch must belong to a company']
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  batchNumber: {
    type: String,
    trim: true,
    uppercase: true
  },
  lotNumber: {
    type: String,
    trim: true,
    uppercase: true
  },
  expiryDate: {
    type: Date
  },
  quantity: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide quantity'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  availableQuantity: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide available quantity'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  reservedQuantity: {
    type: mongoose.Schema.Types.Decimal128,
    default: mongoose.Types.Decimal128.fromString('0.0000'),
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  unitCost: {
    type: mongoose.Schema.Types.Decimal128,
    default: mongoose.Types.Decimal128.fromString('0.000000'),
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  totalCost: {
    type: mongoose.Schema.Types.Decimal128,
    default: mongoose.Types.Decimal128.fromString('0.00'),
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  // For tracking incoming stock movement
  stockMovement: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockMovement'
  },
  // Additional metadata
  manufacturingDate: {
    type: Date
  },
  notes: String,
  // Status: active, partially_used, exhausted, expired, quarantined
  status: {
    type: String,
    enum: ['active', 'partially_used', 'exhausted', 'expired', 'quarantined'],
    default: 'active'
  },
  receivedDate: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
inventoryBatchSchema.index({ company: 1, product: 1 });
inventoryBatchSchema.index({ company: 1, warehouse: 1 });
inventoryBatchSchema.index({ batchNumber: 1, company: 1 });
inventoryBatchSchema.index({ lotNumber: 1, company: 1 });
inventoryBatchSchema.index({ expiryDate: 1, company: 1 });
inventoryBatchSchema.index({ product: 1, warehouse: 1, status: 1 });

// Virtual for checking if batch is expired
inventoryBatchSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual for checking if batch is low stock
inventoryBatchSchema.virtual('isLowStock').get(function() {
  return this.availableQuantity > 0 && this.availableQuantity <= 10;
});

// Virtual for checking if batch is nearing expiration (within 30 days)
inventoryBatchSchema.virtual('isNearingExpiry').get(function() {
  if (!this.expiryDate) return false;
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  return this.expiryDate <= thirtyDaysFromNow && this.expiryDate > new Date();
});

// Update status based on quantities
inventoryBatchSchema.methods.updateStatus = function() {
  try {
    const avail = this.availableQuantity && this.availableQuantity.toString ? parseFloat(this.availableQuantity.toString()) : Number(this.availableQuantity || 0);
    const qty = this.quantity && this.quantity.toString ? parseFloat(this.quantity.toString()) : Number(this.quantity || 0);
    if (avail === 0 && (this.reservedQuantity == null || parseFloat(this.reservedQuantity.toString() || '0') === 0)) {
      this.status = 'exhausted';
    } else if (avail < qty) {
      this.status = 'partially_used';
    } else if (this.isExpired) {
      this.status = 'expired';
    } else {
      this.status = 'active';
    }
  } catch (e) {
    this.status = this.status || 'active';
  }
  return this;
};

// Pre-save middleware to calculate totals
inventoryBatchSchema.pre('save', function(next) {
  try {
    const q = this.quantity && this.quantity.toString ? parseFloat(this.quantity.toString()) : Number(this.quantity || 0);
    const uc = this.unitCost && this.unitCost.toString ? parseFloat(this.unitCost.toString()) : Number(this.unitCost || 0);
    const total = q * uc;
    this.totalCost = mongoose.Types.Decimal128.fromString((isFinite(total) ? total.toFixed(2) : '0.00'));
    this.updateStatus();
    next();
  } catch (err) {
    next(err);
  }
});

// Set toJSON and toObject to include virtuals
// Serialize Decimal128 fields as strings for API
inventoryBatchSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const toQty = (v) => v == null ? '0.0000' : parseFloat(v.toString()).toFixed(4);
    const toMoney = (v) => v == null ? '0.00' : parseFloat(v.toString()).toFixed(2);
    if (ret.quantity !== undefined) ret.quantity = toQty(ret.quantity);
    if (ret.availableQuantity !== undefined) ret.availableQuantity = toQty(ret.availableQuantity);
    if (ret.reservedQuantity !== undefined) ret.reservedQuantity = toQty(ret.reservedQuantity);
    if (ret.unitCost !== undefined) ret.unitCost = toMoney(ret.unitCost);
    if (ret.totalCost !== undefined) ret.totalCost = toMoney(ret.totalCost);
    return ret;
  }
});
inventoryBatchSchema.set('toObject', { virtuals: true });

// Apply audit plugin
const auditPlugin = require('./plugins/auditSoftDeletePlugin');
inventoryBatchSchema.plugin(auditPlugin);

// Convert Decimal128 results to JS numbers for compatibility with tests and lean queries
const decimalTransform = require('./plugins/decimalTransformPlugin');
inventoryBatchSchema.plugin(decimalTransform);

module.exports = mongoose.model('InventoryBatch', inventoryBatchSchema);
