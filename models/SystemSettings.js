const mongoose = require('mongoose')

const systemSettingsSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true // One settings document per company
  },

  // ── INVOICE SETTINGS ──────────────────────────────────────────
  invoice_prefix: {
    type: String,
    default: 'INV'
    // Prefix for invoice reference numbers
  },
  invoice_footer_text: {
    type: String,
    default: null
    // Shown at the bottom of every invoice PDF
  },
  invoice_payment_instructions: {
    type: String,
    default: null
    // Bank details or payment methods shown on invoices
  },
  default_invoice_due_days: {
    type: Number,
    default: 30
  },
  default_quote_expiry_days: {
    type: Number,
    default: 30
  },

  // ── TAX SETTINGS ──────────────────────────────────────────────
  auto_apply_vat: {
    type: Boolean,
    default: false
    // When true, VAT is automatically added to all sales lines
  },
  default_vat_rate_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxRate',
    default: null
  },

  // ── STOCK SETTINGS ────────────────────────────────────────────
  default_costing_method: {
    type: String,
    enum: ['fifo', 'wac'],
    default: 'fifo'
  },
  allow_negative_stock: {
    type: Boolean,
    default: false
    // When false, dispatching more than on-hand is blocked
  },
  low_stock_alert_enabled: {
    type: Boolean,
    default: true
  },

  // ── APPROVAL WORKFLOWS ────────────────────────────────────────
  require_po_approval: {
    type: Boolean,
    default: true
    // POs must be approved before GRNs can be raised
  },
  po_approval_threshold: {
    type: Number,
    default: 0
    // POs above this amount require approval. 0 = all POs require approval
  },
  require_invoice_approval: {
    type: Boolean,
    default: false
  },

  // ── DOCUMENT SETTINGS ─────────────────────────────────────────
  document_terms_and_conditions: {
    type: String,
    default: null
    // Shown on POs, invoices, and quotes
  },
  document_theme_color: {
    type: String,
    default: '#1D9E75'
    // Hex color for document headers and accents
  },

  // ── NOTIFICATION SETTINGS (used in Phase 2) ───────────────────
  notify_on_low_stock: {
    type: Boolean,
    default: true
  },
  notify_on_overdue_invoice: {
    type: Boolean,
    default: true
  },
  overdue_invoice_alert_days: {
    type: Number,
    default: 7
    // Alert when invoice is this many days overdue
  },

  last_updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
})

module.exports = mongoose.model('SystemSettings', systemSettingsSchema)
