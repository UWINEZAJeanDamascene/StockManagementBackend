const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// Module 8 - Credit Note Line Schema
const creditNoteLineSchema = new mongoose.Schema({
  invoiceLineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice.lines',
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Denormalized fields for reporting
  productName: String,
  productCode: String,
  unit: String,
  
  // Quantity - must not exceed originally invoiced qty
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Unit price - must match original invoice line unit_price
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Unit cost - must match original invoice line unit_cost for COGS reversal
  unitCost: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Line amounts
  lineSubtotal: {
    type: Number,
    default: 0
  },
  lineTax: {
    type: Number,
    default: 0
  },
  lineTotal: {
    type: Number,
    default: 0
  },
  
  // COGS amount for reversal (qty × unit_cost)
  cogsAmount: {
    type: Number,
    default: 0
  },
  
  // Return warehouse - where stock is returned to
  returnToWarehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse'
  },
  
  // For batch-tracked products
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryBatch',
    default: null
  },
  
  // For serial-tracked products
  serialNumbers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockSerialNumber'
  }],
  
  notes: String
});

// Legacy schema alias for backwards compatibility
const creditItemSchema = creditNoteLineSchema;

const refundPaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ['cash','card','bank_transfer','cheque','mobile_money'], required: true },
  reference: String,
  refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  refundedAt: { type: Date, default: Date.now }
});

// Module 8 - Credit Note Schema
const creditNoteSchema = new mongoose.Schema({
  // Multi-tenancy
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  
  // Module 8: Reference number CN-YYYY-NNNNN
  referenceNo: {
    type: String,
    uppercase: true,
    unique: true
  },
  
  // Legacy field for backwards compatibility
  creditNoteNumber: {
    type: String,
    uppercase: true
  },
  
  // References
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  
  // Dates
  creditDate: {
    type: Date,
    default: Date.now
  },
  
  // Reason - required, why is credit being issued
  reason: {
    type: String,
    required: true
  },
  
  // Module 8: Type enum
  type: {
    type: String,
    enum: ['goods_return', 'price_adjustment', 'cancelled_order'],
    required: true
  },
  
  // Module 8: Status enum - draft, confirmed, cancelled
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'cancelled'],
    default: 'draft'
  },
  
  // Legacy statuses for backwards compatibility
  legacyStatus: {
    type: String,
    enum: ['draft', 'issued', 'applied', 'refunded', 'partially_refunded', 'cancelled'],
    default: 'draft'
  },
  
  // Currency
  currencyCode: {
    type: String,
    required: true,
    default: 'USD'
  },
  
  // Amounts
  subtotal: {
    type: Number,
    default: 0
  },
  taxAmount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  
  // Module 8: Journal entry references for COGS and revenue reversal
  revenueReversalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  cogsReversalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  
  // Confirmation
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  confirmedAt: {
    type: Date
  },
  
  // Legacy fields for backwards compatibility
  clientTIN: String,
  relatedInvoice: String,
  amountRefunded: { type: Number, default: 0 },
  appliedTo: String,
  appliedDate: Date,
  payments: [refundPaymentSchema],
  stockReversed: { type: Boolean, default: false },
  
  // Notes
  notes: String,
  
  // User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { 
  timestamps: true 
});

// Compound indexes
creditNoteSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
creditNoteSchema.index({ company: 1 });
creditNoteSchema.index({ company: 1, status: 1 });
creditNoteSchema.index({ invoice: 1 });
creditNoteSchema.index({ client: 1 });
creditNoteSchema.index({ creditDate: 1 });

// Pre-save hook to generate CN-YYYY-NNNNN reference number
creditNoteSchema.pre('save', async function(next) {
  // Generate CN-YYYY-NNNNN format for referenceNo
  if (this.isNew && !this.referenceNo) {
    // generateUniqueNumber already returns 'CN-YYYY-NNNNN'
    this.referenceNo = await generateUniqueNumber('CN', mongoose.model('CreditNote'), this.company, 'referenceNo');
  }
  
  // Legacy: also set creditNoteNumber if not set
  if (this.isNew && !this.creditNoteNumber) {
    this.creditNoteNumber = this.referenceNo;
  }
  
  next();
});

// Calculate totals
creditNoteSchema.pre('save', function(next) {
  // Use lines array (Module 8) or items (legacy)
  const lineArray = this.lines && this.lines.length > 0 ? this.lines : this.items;
  
  if (lineArray && lineArray.length > 0) {
    let subtotal = 0;
    let totalTax = 0;
    
    lineArray.forEach(item => {
      const quantity = item.quantity || 0;
      const unitPrice = item.unitPrice || 0;
      const unitCost = item.unitCost || 0;
      const taxRate = item.taxRate || 0;
      
      const lineSubtotal = quantity * unitPrice;
      const lineTax = lineSubtotal * (taxRate / 100);
      const lineTotal = lineSubtotal + lineTax;
      const cogsAmount = quantity * unitCost;
      
      item.lineSubtotal = lineSubtotal;
      item.lineTax = lineTax;
      item.lineTotal = lineTotal;
      item.cogsAmount = cogsAmount;
      
      subtotal += lineSubtotal;
      totalTax += lineTax;
    });
    
    this.subtotal = subtotal;
    this.taxAmount = totalTax;
    this.totalAmount = subtotal + totalTax;
  }
  
  next();
});

// Calculate totals helper method
creditNoteSchema.methods.calculateTotals = function() {
  const lineArray = this.lines && this.lines.length > 0 ? this.lines : this.items;
  
  if (!lineArray || lineArray.length === 0) {
    return { subtotal: 0, taxAmount: 0, totalAmount: 0 };
  }
  
  const subtotal = lineArray.reduce((sum, item) => sum + (item.lineSubtotal || 0), 0);
  const taxAmount = lineArray.reduce((sum, item) => sum + (item.lineTax || 0), 0);
  const totalAmount = lineArray.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  const cogsAmount = lineArray.reduce((sum, item) => sum + (item.cogsAmount || 0), 0);
  
  return { subtotal, taxAmount, totalAmount, cogsAmount };
};

// Virtual for total quantity
creditNoteSchema.virtual('totalQuantity').get(function() {
  const lineArray = this.lines && this.lines.length > 0 ? this.lines : this.items;
  if (!lineArray) return 0;
  return lineArray.reduce((sum, item) => sum + (item.quantity || 0), 0);
});

// Ensure virtuals are serialized
creditNoteSchema.set('toJSON', { virtuals: true });
creditNoteSchema.set('toObject', { virtuals: true });

// Module 8: Legacy alias for backwards compatibility
// lines is the new name, items kept for backwards compatibility
creditNoteSchema.add({
  lines: [creditNoteLineSchema],
  items: [creditItemSchema] // Legacy alias
});

module.exports = mongoose.model('CreditNote', creditNoteSchema);
