const mongoose = require('mongoose');

const prLineSchema = new mongoose.Schema({
  grnLine: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceivedNote.lines', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qtyReturned: { type: Number, required: true, min: 0.0001 },
  unitCost: { type: Number, required: true, min: 0 }
}, { _id: true });

const purchaseReturnSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  referenceNo: { type: String, required: true, uppercase: true },
  grn: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceivedNote', required: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  returnDate: { type: Date, default: Date.now },
  reason: { type: String, required: true },
  supplierCreditNoteNo: { type: String },
  status: { type: String, enum: ['draft', 'confirmed', 'cancelled'], default: 'draft' },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lines: [prLineSchema],
  // Refund fields
  refundMethod: { type: String, enum: ['none', 'credit', 'bank_transfer', 'cash'], default: 'none' },
  bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount', default: null },
  bankRefundReference: { type: String, default: null },
  refundedAt: { type: Date, default: null },
  refundJournalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  refundBankTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'BankTransaction', default: null }
}, { timestamps: true });

purchaseReturnSchema.index({ company: 1, referenceNo: 1 }, { unique: true });

module.exports = mongoose.model('PurchaseReturn', purchaseReturnSchema);
