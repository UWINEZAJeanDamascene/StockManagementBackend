const mongoose = require('mongoose');

// Recurring Invoice Run - log of every run
const recurringInvoiceRunSchema = new mongoose.Schema({
  // Template reference
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RecurringInvoice',
    required: true
  },
  
  // Company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  
  // The date this run covered
  runDate: {
    type: Date,
    required: true,
    alias: 'run_date'
  },
  
  // The invoice created
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  
  // Status
  status: {
    type: String,
    enum: ['success', 'failed'],
    required: true
  },
  
  // Error message if status = failed
  errorMessage: {
    type: String,
    default: null,
    alias: 'error_message'
  }
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      ret.template_id = ret.template;
      ret.invoice_id = ret.invoice;
      ret.run_date = ret.runDate;
      ret.error_message = ret.errorMessage;
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      ret.template_id = ret.template;
      ret.invoice_id = ret.invoice;
      ret.run_date = ret.runDate;
      ret.error_message = ret.errorMessage;
      return ret;
    }
  }
});

// Indexes - including unique constraint for idempotency (template_id, run_date)
recurringInvoiceRunSchema.index({ company: 1 });
recurringInvoiceRunSchema.index({ template: 1 });
recurringInvoiceRunSchema.index({ company: 1, runDate: 1 });
recurringInvoiceRunSchema.index({ template: 1, createdAt: -1 });
// Unique constraint to prevent duplicate runs on the same day
recurringInvoiceRunSchema.index({ template: 1, runDate: 1 }, { unique: true, partialFilterExpression: { runDate: { $exists: true } } });

module.exports = mongoose.model('RecurringInvoiceRun', recurringInvoiceRunSchema);
