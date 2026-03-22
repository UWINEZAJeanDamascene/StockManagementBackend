const mongoose = require('mongoose');

const poLineSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qtyOrdered: { type: Number, required: true, min: 0 },
  qtyReceived: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  taxAmount: { type: Number, default: 0, min: 0 },
  lineTotal: { type: Number, default: 0, min: 0 }
}, { _id: true });

const purchaseOrderSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  referenceNo: { type: String, required: true, uppercase: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  orderDate: { type: Date, default: Date.now },
  expectedDeliveryDate: Date,
  status: { type: String, enum: ['draft', 'approved', 'partially_received', 'fully_received', 'cancelled'], default: 'draft' },
  currencyCode: { type: String, default: 'USD' },
  exchangeRate: { type: Number, default: 1 },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  notes: String,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lines: [poLineSchema]
}, { timestamps: true });

purchaseOrderSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
purchaseOrderSchema.index({ company: 1, status: 1 });
purchaseOrderSchema.index({ company: 1, status: 1, orderDate: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
