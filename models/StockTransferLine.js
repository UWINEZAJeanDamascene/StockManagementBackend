const mongoose = require('mongoose');

const stockTransferLineSchema = new mongoose.Schema({
  // Multi-tenancy: company reference (denormalized for direct queries)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  transfer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockTransfer',
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  qty: {
    // Quantities use Decimal128 for high precision (18,4 equivalent)
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Please provide quantity'],
    validate: {
      validator: function(v) {
        try {
          const n = parseFloat(v.toString());
          return n > 0;
        } catch (e) { return false; }
      },
      message: 'Quantity must be greater than 0'
    }
  },
  unitCost: {
    // Unit cost uses Decimal128 precision (18,6 equivalent)
    type: mongoose.Schema.Types.Decimal128,
    required: false,
    default: null
  },
  notes: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

stockTransferLineSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.qty && ret.qty.toString) ret.qty = parseFloat(ret.qty.toString());
    if (ret.unitCost && ret.unitCost.toString) ret.unitCost = ret.unitCost.toString();
    return ret;
  }
});

module.exports = mongoose.model('StockTransferLine', stockTransferLineSchema);
