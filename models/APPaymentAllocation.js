const mongoose = require('mongoose');

const apPaymentAllocationSchema = new mongoose.Schema({
  // Payment (foreign key to ap_payments)
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'APPayment',
    required: true,
    index: true
  },
  
  // GRN / Invoice being paid (foreign key to goods_received_notes)
  grn: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GRN',
    required: true,
    index: true
  },
  
  // Amount allocated (DECIMAL(18,2))
  amountAllocated: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    get: function(value) {
      return value ? parseFloat(value.toString()) : null;
    }
  },
  
  // Company (tenant)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  
  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound unique index: each GRN can only be allocated to a payment once
apPaymentAllocationSchema.index({ payment: 1, grn: 1 }, { unique: true });

// Index for finding allocations by GRN
apPaymentAllocationSchema.index({ grn: 1 });
apPaymentAllocationSchema.index({ company: 1 });

// Static method to find allocations for a payment
apPaymentAllocationSchema.statics.findByPayment = function(paymentId) {
  return this.find({ payment: paymentId })
    .populate('grn', 'grnNumber referenceNo totalAmount balance')
    .sort({ createdAt: -1 });
};

// Static method to find allocations for a GRN
apPaymentAllocationSchema.statics.findByGRN = function(grnId) {
  return this.find({ grn: grnId })
    .populate('payment', 'referenceNo paymentDate amountPaid status')
    .sort({ createdAt: -1 });
};

// Static method to calculate total allocated for a payment
apPaymentAllocationSchema.statics.getTotalAllocated = async function(paymentId) {
  const result = await this.aggregate([
    { $match: { payment: mongoose.Types.ObjectId(paymentId) } },
    { $group: { _id: null, total: { $sum: '$amountAllocated' } } }
  ]);
  return result[0]?.total || 0;
};

// Static method to calculate total allocated for a GRN
apPaymentAllocationSchema.statics.getTotalAllocatedForGRN = async function(grnId) {
  const result = await this.aggregate([
    { $match: { grn: mongoose.Types.ObjectId(grnId) } },
    { $group: { _id: null, total: { $sum: '$amountAllocated' } } }
  ]);
  return result[0]?.total || 0;
};

module.exports = mongoose.model('APPaymentAllocation', apPaymentAllocationSchema);
