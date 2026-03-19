const mongoose = require('mongoose');

const stockBatchSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Stock batch must belong to a company']
  },
  // Batch reference (supplier or internal)
  batchNo: {
    type: String,
    required: [true, 'Please provide a batch number'],
    trim: true,
    uppercase: true,
    maxlength: 100
  },
  // Product reference
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Warehouse reference
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  // GRN that created this batch
  grn: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoodsReceivedNote',
    default: null
  },
  // Original quantity received
  qtyReceived: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide quantity received'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Current remaining quantity
  qtyOnHand: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide quantity on hand'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Cost per unit
  unitCost: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide unit cost'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Manufacturing date
  manufactureDate: {
    type: Date,
    default: null
  },
  // Expiry date
  expiryDate: {
    type: Date,
    default: null
  },
  // Quarantine status - quarantined batches cannot be dispatched
  isQuarantined: {
    type: Boolean,
    default: false
  },
  // Additional notes
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Compound unique index: batchNo + product + warehouse must be unique
stockBatchSchema.index({ batchNo: 1, product: 1, warehouse: 1 }, { unique: true });

// Indexes for efficient querying
stockBatchSchema.index({ company: 1 });
stockBatchSchema.index({ company: 1, product: 1 });
stockBatchSchema.index({ company: 1, warehouse: 1 });
stockBatchSchema.index({ product: 1, warehouse: 1, isQuarantined: 1 });
stockBatchSchema.index({ expiryDate: 1, company: 1 });

// Virtual for checking if batch is expired
stockBatchSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual for checking if batch is nearing expiration (within 30 days)
stockBatchSchema.virtual('isNearingExpiry').get(function() {
  if (!this.expiryDate) return false;
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  return this.expiryDate <= thirtyDaysFromNow && this.expiryDate > new Date();
});

// Virtual for total value of batch
stockBatchSchema.virtual('totalValue').get(function() {
  const qty = this.qtyOnHand || 0;
  const cost = this.unitCost || 0;
  const qtyNum = typeof qty === 'number' ? qty : parseFloat(qty.toString());
  const costNum = typeof cost === 'number' ? cost : parseFloat(cost.toString());
  return qtyNum * costNum;
});

// Pre-save middleware
stockBatchSchema.pre('save', async function(next) {
  // If qtyOnHand not set, set to qtyReceived
  if (this.isNew && this.qtyOnHand == null) {
    this.qtyOnHand = this.qtyReceived;
  }
  next();
});

// Serialize Decimal128 fields as strings for API
stockBatchSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const toQty = (v) => {
      if (v == null) return '0.0000';
      const num = typeof v === 'number' ? v : parseFloat(v.toString());
      return isFinite(num) ? num.toFixed(4) : '0.0000';
    };
    const toMoney = (v) => {
      if (v == null) return '0.000000';
      const num = typeof v === 'number' ? v : parseFloat(v.toString());
      return isFinite(num) ? num.toFixed(6) : '0.000000';
    };
    if (ret.qtyReceived !== undefined) ret.qtyReceived = toQty(ret.qtyReceived);
    if (ret.qtyOnHand !== undefined) ret.qtyOnHand = toQty(ret.qtyOnHand);
    if (ret.unitCost !== undefined) ret.unitCost = toMoney(ret.unitCost);
    return ret;
  }
});

stockBatchSchema.set('toObject', { virtuals: true });

// Apply audit plugin
const auditPlugin = require('./plugins/auditSoftDeletePlugin');
stockBatchSchema.plugin(auditPlugin);

// Convert Decimal128 results to JS numbers
const decimalTransform = require('./plugins/decimalTransformPlugin');
stockBatchSchema.plugin(decimalTransform);

module.exports = mongoose.model('StockBatch', stockBatchSchema);
