const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

const poLineSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qtyOrdered: { type: Number, required: true, min: 0 },
  qtyReceived: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  taxAmount: { type: Number, default: 0, min: 0 },
  lineTotal: { type: Number, default: 0, min: 0 },
  budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' },
  budget_line_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BudgetLine' },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount' },
  encumbrance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Encumbrance' }
}, { _id: true });

const purchaseOrderPaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['cash', 'card', 'bank_transfer', 'cheque', 'mobile_money', 'credit'], required: true },
  reference: String,
  notes: String,
  paidDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });

const purchaseOrderSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  referenceNo: { type: String, uppercase: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  orderDate: { type: Date, default: Date.now },
  expectedDeliveryDate: Date,
  status: { type: String, enum: ['draft', 'approved', 'partially_received', 'fully_received', 'cancelled'], default: 'draft' },
  currencyCode: { type: String, default: 'FRW' },
  exchangeRate: { type: Number, default: 1 },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  payments: [purchaseOrderPaymentSchema],
  notes: String,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lines: [poLineSchema]
}, { timestamps: true });

purchaseOrderSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
purchaseOrderSchema.index({ company: 1, status: 1 });
purchaseOrderSchema.index({ company: 1, status: 1, orderDate: 1 });

// Auto-generate reference number
purchaseOrderSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    this.referenceNo = await generateUniqueNumber('PO', mongoose.model('PurchaseOrder'), this.company, 'referenceNo');
  }
  next();
});

// Calculate totals from lines before saving
purchaseOrderSchema.pre('save', function(next) {
  if (this.lines && this.lines.length > 0) {
    let subtotal = 0;
    let taxAmount = 0;

    this.lines.forEach(line => {
      const lineSubtotal = (Number(line.qtyOrdered) || 0) * (Number(line.unitCost) || 0);
      const lineTax = lineSubtotal * ((Number(line.taxRate) || 0) / 100);
      const lineTotal = lineSubtotal + lineTax;

      // Update line-level calculated fields
      line.taxAmount = lineTax;
      line.lineTotal = lineTotal;

      subtotal += lineSubtotal;
      taxAmount += lineTax;
    });

    this.subtotal = subtotal;
    this.taxAmount = taxAmount;
    this.totalAmount = subtotal + taxAmount;
  } else {
    this.subtotal = 0;
    this.taxAmount = 0;
    this.totalAmount = 0;
  }
  next();
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
