const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const passwordUtils = require('../utils/passwordUtils');

// Error codes for user operations
const USER_ERRORS = {
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  CURRENT_PASSWORD_INCORRECT: 'CURRENT_PASSWORD_INCORRECT',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  INVALID_OR_EXPIRED_TOKEN: 'INVALID_OR_EXPIRED_TOKEN',
  USER_ALREADY_MEMBER: 'USER_ALREADY_MEMBER'
};

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false
  },
  // Legacy plain refresh (migrated to refresh_token_hash only)
  refresh_token: {
    type: String,
    select: false,
    default: null
  },
  refresh_token_hash: {
    type: String,
    select: false,
    default: null
  },
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: function() {
      // Company is required unless user is a platform admin
      return this.role !== 'platform_admin';
    }
  },
  role: {
    // Legacy single-role kept for backward compatibility. Prefer `roles` array of Role refs.
    type: String,
    enum: ['platform_admin', 'admin', 'stock_manager', 'sales', 'viewer', 'accountant', 'manager', 'purchaser', 'warehouse_manager'],
    default: 'viewer'
  },
  roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
  // Department-based access
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Password management fields
  mustChangePassword: {
    type: Boolean,
    default: false
  },
  passwordChangedAt: {
    type: Date,
    default: null
  },
  tempPassword: {
    type: Boolean,
    default: false
  },
  // Two-factor authentication (TOTP)
  twoFAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String, select: false, default: null },
  twoFAConfirmed: { type: Boolean, default: false },
  // Optional per-user IP whitelist (array of IP strings)
  ipWhitelist: [{ type: String }],
  // Login security fields
  failed_login_attempts: {
    type: Number,
    default: 0
  },
  locked_until: {
    type: Date,
    default: null
  },
  // Password reset token
  passwordResetToken: {
    type: String,
    select: false,
    default: null
  },
  passwordResetExpires: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for company + email uniqueness
userSchema.index({ company: 1, email: 1 }, { unique: true });

// Index for password reset token
userSchema.index({ passwordResetToken: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    this.password = await passwordUtils.hash(this.password);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Compare password
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function() {
  if (!this.locked_until) return false;
  return new Date() < this.locked_until;
};

// Increment failed login attempts and optionally lock
userSchema.methods.incrementFailedLoginAttempts = async function(maxAttempts = 5, lockDurationMinutes = 30) {
  // Check if lock has expired - reset counter if so
  if (this.locked_until && new Date() >= this.locked_until) {
    this.failed_login_attempts = 0;
    this.locked_until = null;
  }
  
  this.failed_login_attempts += 1;
  
  if (this.failed_login_attempts >= maxAttempts) {
    // Lock the account
    this.locked_until = new Date(Date.now() + lockDurationMinutes * 60 * 1000);
  }
  
  return this.save();
};

// Reset failed login attempts on successful login
userSchema.methods.resetFailedLoginAttempts = function() {
  this.failed_login_attempts = 0;
  this.locked_until = null;
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refresh_token;
  delete obj.refresh_token_hash;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.twoFASecret;
  return obj;
};

// Static method to find by email (case-insensitive)
userSchema.statics.findByEmail = function(email, companyId = null) {
  const query = { email: email.toLowerCase() };
  if (companyId) {
    query.company = companyId;
  }
  return this.findOne(query);
};

// Export error codes
userSchema.statics.ERRORS = USER_ERRORS;

module.exports = mongoose.model('User', userSchema);
