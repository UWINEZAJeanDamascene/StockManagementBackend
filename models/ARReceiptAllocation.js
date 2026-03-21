const mongoose = require('mongoose');

// ar_receipt_allocations table - links each receipt to the invoices it pays
const arReceiptAllocationSchema = new mongoose.Schema({
  // Reference to the receipt
  receipt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ARReceipt',
    required: [true, 'Receipt is required']
  },

  // Reference to the invoice being paid
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: [true, 'Invoice is required']
  },

  // Portion of this receipt applied to this invoice - DECIMAL(18,2)
  amountAllocated: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Amount allocated is required'],
    min: 0
  },

  // Company (for multi-tenancy)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },

  // Created by user
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      // Convert Decimal128 to string for JSON API
      if (ret.amountAllocated) ret.amountAllocated = ret.amountAllocated.toString();
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(doc, ret) {
      if (ret.amountAllocated) ret.amountAllocated = ret.amountAllocated.toString();
      return ret;
    }
  }
});

// Compound unique index - one allocation per invoice per receipt
arReceiptAllocationSchema.index({ receipt: 1, invoice: 1 }, { unique: true });

// Indexes for performance
arReceiptAllocationSchema.index({ company: 1 });
arReceiptAllocationSchema.index({ company: 1, receipt: 1 });
arReceiptAllocationSchema.index({ company: 1, invoice: 1 });
arReceiptAllocationSchema.index({ receipt: 1 });
arReceiptAllocationSchema.index({ invoice: 1 });

// Virtual for amount as number
arReceiptAllocationSchema.virtual('amount').get(function() {
  return parseFloat(this.amountAllocated) || 0;
});

module.exports = mongoose.model('ARReceiptAllocation', arReceiptAllocationSchema);
