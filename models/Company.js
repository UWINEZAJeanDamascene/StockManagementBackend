const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  street:   { type: String, trim: true, default: null },
  city:     { type: String, trim: true, default: null },
  state:    { type: String, trim: true, default: null },
  country:  { type: String, trim: true, default: 'Rwanda' },
  postcode: { type: String, trim: true, default: null }
}, { _id: false });

const companySchema = new mongoose.Schema({
  name: {
    type:     String,
    required: true,
    trim:     true
  },
  code: {
    type:      String,
    required:  false, // Made optional with default for backward compatibility
    uppercase: true,
    trim:      true,
    default:  function() {
      // Generate code from name if not provided
      return (this.name || 'COMPANY').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4) + Date.now().toString(36).toUpperCase();
    }
    // Short identifier e.g. 'ACME' — used in reference numbers
  },
  legal_name: {
    type:    String,
    trim:    true,
    default: null
    // Full registered legal name — appears on documents
  },
  registration_number: {
    type:    String,
    trim:    true,
    default: null
    // Company registration / TIN number
  },
  tax_identification_number: {
    type:    String,
    trim:    true,
    default: null
    // VAT registration number
  },
  email: {
    type:    String,
    trim:    true,
    lowercase: true,
    default: null
  },
  phone: {
    type:    String,
    trim:    true,
    default: null
  },
  website: {
    type:    String,
    trim:    true,
    default: null
  },
  address: {
    type:    addressSchema,
    default: () => ({}),
    set: function(v) {
      // Handle both string and object inputs for backward compatibility
      if (!v) return {};
      if (typeof v === 'string') {
        return { street: v };
      }
      return v;
    }
  },
  logo_url: {
    type:    String,
    default: null
    // URL to uploaded company logo — shown on invoices, reports
  },
  base_currency: {
    type:     String,
    required: true,
    default:  'RWF',
    uppercase: true,
    trim:     true
    // ISO 4217 — immutable once transactions exist
  },
  fiscal_year_start_month: {
    type:     Number,
    required: true,
    default:  1,
    min:      1,
    max:      12
    // 1 = January, 7 = July (Rwanda fiscal year starts July)
  },
  default_payment_terms_days: {
    type:    Number,
    default: 30
    // Default days before invoice is due — applied to new invoices
  },
  industry: {
    type:    String,
    trim:    true,
    default: null
  },
  isActive: {
    type:    Boolean,
    default: true
  },
  approvalStatus: {
    type:    String,
    enum:    ['pending', 'approved', 'rejected'],
    default: 'approved'  // Allow login in tests
  },
  /** Set when platform_admin rejects a public registration */
  registration_rejection_reason: {
    type:    String,
    trim:    true,
    default: null
  },
  is_vat_registered: {
    type:    Boolean,
    default: false
  },
  vat_rate_pct: {
    type:    Number,
    default: 18
    // Rwanda standard VAT rate
  },
  setup_completed: {
    type:    Boolean,
    default: false
    // Set to true when onboarding wizard is finished
  },
  setup_steps_completed: {
    // Tracks which onboarding steps are done
    company_profile:   { type: Boolean, default: false },
    chart_of_accounts: { type: Boolean, default: false },
    opening_balances:  { type: Boolean, default: false },
    first_user:        { type: Boolean, default: false },
    first_period:      { type: Boolean, default: false }
  },
  subscription_plan: {
    type:    String,
    enum:    ['trial', 'starter', 'professional', 'enterprise'],
    default: 'trial'
  },
  trial_ends_at: {
    type:    Date,
    default: null
  },
  created_by: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null
  }
}, {
  timestamps: true
});

companySchema.index({ code: 1 }, { unique: true });
companySchema.index({ isActive: 1 });

module.exports = mongoose.model('Company', companySchema);
