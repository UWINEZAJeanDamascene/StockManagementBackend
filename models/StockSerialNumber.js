const mongoose = require('mongoose');

const stockSerialNumberSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Serial number must belong to a company']
  },
  // Serial number - unique per product
  serialNo: {
    type: String,
    required: [true, 'Please provide a serial number'],
    trim: true,
    uppercase: true,
    maxlength: 150
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
  // GRN that received this serial number
  grn: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoodsReceivedNote',
    default: null
  },
  // Optional batch link
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockBatch',
    default: null
  },
  // Unit cost
  unitCost: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide unit cost'],
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Status: in_stock, reserved, dispatched, returned, scrapped
  status: {
    type: String,
    enum: ['in_stock', 'reserved', 'dispatched', 'returned', 'scrapped'],
    default: 'in_stock',
    required: true
  },
  // Reference to delivery note line that dispatched this serial
  dispatchedVia: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryNote',
    default: null
  },
  // Reference to credit note line that returned this serial
  returnedVia: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditNote',
    default: null
  },
  // Additional notes
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Unique index: serial number must be unique per product (not globally)
stockSerialNumberSchema.index({ product: 1, serialNo: 1 }, { unique: true });

// Indexes for efficient querying
stockSerialNumberSchema.index({ company: 1 });
stockSerialNumberSchema.index({ company: 1, product: 1 });
stockSerialNumberSchema.index({ company: 1, warehouse: 1 });
stockSerialNumberSchema.index({ product: 1, status: 1 });
stockSerialNumberSchema.index({ warehouse: 1, status: 1 });
stockSerialNumberSchema.index({ batch: 1 });

// Virtual for checking if serial is available
stockSerialNumberSchema.virtual('isAvailable').get(function() {
  return this.status === 'in_stock';
});

// Static method to find available serial numbers for a product
stockSerialNumberSchema.statics.findAvailable = function(productId, companyId, warehouseId = null) {
  const query = {
    product: productId,
    company: companyId,
    status: 'in_stock'
  };
  if (warehouseId) {
    query.warehouse = warehouseId;
  }
  return this.find(query);
};

// Static method to find by serial number for a product
stockSerialNumberSchema.statics.findBySerial = function(serialNo, productId, companyId) {
  return this.findOne({
    serialNo: serialNo.toUpperCase(),
    product: productId,
    company: companyId
  });
};

// Pre-save middleware
stockSerialNumberSchema.pre('save', async function(next) {
  // Ensure serial number is uppercase
  if (this.serialNo) {
    this.serialNo = this.serialNo.toUpperCase();
  }
  next();
});

// Serialize Decimal128 fields as strings for API
stockSerialNumberSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const toMoney = (v) => {
      if (v == null) return '0.000000';
      const num = typeof v === 'number' ? v : parseFloat(v.toString());
      return isFinite(num) ? num.toFixed(6) : '0.000000';
    };
    if (ret.unitCost !== undefined) ret.unitCost = toMoney(ret.unitCost);
    return ret;
  }
});

stockSerialNumberSchema.set('toObject', { virtuals: true });

// Apply audit plugin
const auditPlugin = require('./plugins/auditSoftDeletePlugin');
stockSerialNumberSchema.plugin(auditPlugin);

// Convert Decimal128 results to JS numbers
const decimalTransform = require('./plugins/decimalTransformPlugin');
stockSerialNumberSchema.plugin(decimalTransform);

module.exports = mongoose.model('StockSerialNumber', stockSerialNumberSchema);
