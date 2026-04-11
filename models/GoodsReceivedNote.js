const mongoose = require('mongoose');

const grnLineSchema = new mongoose.Schema({
  purchaseOrderLine: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder.lines' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qtyReceived: { type: Number, required: true, min: 0.01 },
  unitCost: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  batchNo: { type: String },
  manufactureDate: { type: Date, default: null },
  expiryDate: { type: Date, default: null },
  serialNumbers: [{ type: String }]
}, { _id: true });

const grnSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  referenceNo: { type: String, required: true, uppercase: true },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', index: true },
  receivedDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['draft', 'confirmed'], default: 'draft' },
  supplierInvoiceNo: { type: String },
  
  // AP Integration fields
  totalAmount: { type: mongoose.Schema.Types.Decimal128, default: 0 },
  balance: { type: mongoose.Schema.Types.Decimal128, default: 0 },
  amountPaid: { type: mongoose.Schema.Types.Decimal128, default: 0 },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'partially_paid', 'paid'], 
    default: 'pending',
    index: true
  },
  paymentDueDate: { type: Date, index: true },
  
  journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  lines: [grnLineSchema]
}, { timestamps: true });

grnSchema.index({ company: 1, referenceNo: 1 }, { unique: true });

module.exports = mongoose.model('GoodsReceivedNote', grnSchema);
