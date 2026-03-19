const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// Recurring invoice line item schema - identical to sales_invoice_lines
const recurringLineSchema = new mongoose.Schema({
  // Line reference
  lineId: {
    type: mongoose.Schema.Types.ObjectId,
    default: () => new mongoose.Types.ObjectId()
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  productCode: String,
  description: String,
  
  // Quantities and pricing
  qty: {
    type: Number,
    required: true,
    min: 0.0001,
    alias: 'quantity'
  },
  unit: String,
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  discountPct: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    alias: 'discount'
  },
  taxRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  taxCode: {
    type: String,
    enum: ['A', 'B', 'None'],
    default: 'A'
  },
  
  // Line totals
  lineSubtotal: {
    type: Number,
    default: 0,
    alias: 'subtotal'
  },
  lineTax: {
    type: Number,
    default: 0,
    alias: 'taxAmount'
  },
  lineTotal: {
    type: Number,
    default: 0,
    alias: 'totalWithTax'
  },
  
  // Warehouse for stock
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse'
  }
},
{
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for backwards compatibility
recurringLineSchema.virtual('quantity').get(function() {
  return this.qty;
});
recurringLineSchema.virtual('itemCode').get(function() {
  return this.productCode;
});

// Schedule schema
const scheduleSchema = new mongoose.Schema({
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'annually'],
    required: true
  },
  interval: {
    type: Number,
    default: 1,
    min: 1
  },
  // optional: day of month for monthly schedules (1-28/31)
  dayOfMonth: Number,
  // optional: day of week for weekly schedules (0-6)
  dayOfWeek: Number
});

// Main recurring invoice template schema - Module 9
const recurringInvoiceSchema = new mongoose.Schema({
  // Reference number - Module 9 format (REC-NNNNN)
  referenceNo: {
    type: String,
    uppercase: true,
    unique: true
  },
  
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  
  // Client reference
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  
  // Invoice lines - identical structure to sales_invoice_lines
  lines: {
    type: [recurringLineSchema],
    alias: 'items',
    default: []
  },
  
  // Schedule configuration
  schedule: scheduleSchema,
  
  // Dates - Module 9 naming
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    default: null // null = runs indefinitely
  },
  nextRunDate: {
    type: Date,
    required: true
  },
  
  // Status - Module 9 enum
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'cancelled'],
    default: 'active'
  },
  
  // Auto-confirm - if TRUE, invoice is confirmed automatically. If FALSE, draft only.
  autoConfirm: {
    type: Boolean,
    default: false
  },
  
  // Currency - Module 9 naming
  currencyCode: {
    type: String,
    default: 'USD',
    alias: 'currency_code'
  },
  
  // Notes
  notes: {
    type: String,
    default: null
  },
  
  // Last run timestamp
  lastRunAt: {
    type: Date,
    default: null,
    alias: 'last_run_at'
  },
  
  // User tracking
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
      // Backwards compatibility aliases
      ret.reference_no = ret.referenceNo;
      ret.start_date = ret.startDate;
      ret.end_date = ret.endDate;
      ret.next_run_date = ret.nextRunDate;
      ret.auto_confirm = ret.autoConfirm;
      ret.last_run_at = ret.lastRunAt;
      ret.currency_code = ret.currencyCode;
      ret.invoice_lines = ret.lines || ret.items;
      ret.items = ret.lines || ret.items;
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Backwards compatibility aliases
      ret.reference_no = ret.referenceNo;
      ret.start_date = ret.startDate;
      ret.end_date = ret.endDate;
      ret.next_run_date = ret.nextRunDate;
      ret.auto_confirm = ret.autoConfirm;
      ret.last_run_at = ret.lastRunAt;
      ret.currency_code = ret.currencyCode;
      ret.invoice_lines = ret.lines || ret.items;
      ret.items = ret.lines || ret.items;
      return ret;
    }
  }
});

// Indexes
recurringInvoiceSchema.index({ company: 1 });
recurringInvoiceSchema.index({ company: 1, status: 1 });
recurringInvoiceSchema.index({ company: 1, nextRunDate: 1 });

// Auto-generate reference number - Module 9 format REC-NNNNN
recurringInvoiceSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    const { generateUniqueNumberNoYear } = require('./utils/autoIncrement');
    this.referenceNo = await generateUniqueNumberNoYear('REC', mongoose.model('RecurringInvoice'), this.company, 'referenceNo');
  }
  next();
});

// Virtual for backwards compatibility
recurringInvoiceSchema.virtual('items').get(function() {
  return this.lines || this.items;
});

module.exports = mongoose.model('RecurringInvoice', recurringInvoiceSchema);
