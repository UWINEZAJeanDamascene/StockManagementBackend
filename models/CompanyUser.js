/**
 * CompanyUser Model
 * 
 * Many-to-Many relationship between User and Company
 * Used for platform admins who need access to multiple companies
 * Also tracks user-company associations with additional metadata
 */

const mongoose = require('mongoose');

const companyUserSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company reference is required']
  },
  role: {
    type: String,
    enum: ['platform_admin', 'admin', 'manager', 'viewer', 'stock_manager', 'sales', 'accountant'],
    default: 'viewer'
  },
  // Access permissions specific to this user-company relationship
  permissions: [{
    resource: {
      type: String,
      required: true
    },
    actions: [{
      type: String,
      enum: ['create', 'read', 'update', 'delete']
    }]
  }],
  // Status of this user-company association
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'suspended'],
    default: 'active'
  },
  // When this association was approved (if required)
  approvedAt: {
    type: Date
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Custom department assignment for this company
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  // Preferred settings for this user-company combination
  preferences: {
    defaultWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    defaultCurrency: { type: String, default: 'USD' },
    theme: { type: String, default: 'light' },
    language: { type: String, default: 'en' },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    }
  },
  // Last active timestamp for this user-company
  lastActiveAt: {
    type: Date
  },
  // Primary contact for this user at this company
  isPrimaryContact: {
    type: Boolean,
    default: false
  },
  // Job title at the company
  jobTitle: {
    type: String,
    trim: true
  },
  // Phone number at the company
  phone: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Compound unique index: one role per user per company
companyUserSchema.index({ user: 1, company: 1 }, { unique: true });

// Index for finding all companies a user belongs to
companyUserSchema.index({ user: 1, status: 1 });

// Index for finding all users in a company
companyUserSchema.index({ company: 1, status: 1 });

/**
 * Check if user has specific permission for a resource
 */
companyUserSchema.methods.hasPermission = function(resource, action) {
  const permission = this.permissions.find(p => p.resource === resource);
  if (!permission) return false;
  return permission.actions.includes(action);
};

/**
 * Check if user is active for this company
 */
companyUserSchema.methods.isActive = function() {
  return this.status === 'active';
};

/**
 * Update last active timestamp
 */
companyUserSchema.methods.updateLastActive = async function() {
  this.lastActiveAt = new Date();
  return this.save();
};

/**
 * Static method to find user's companies
 */
companyUserSchema.statics.findUserCompanies = function(userId, options = {}) {
  const query = { user: userId };
  if (options.status) query.status = options.status;
  
  return this.find(query)
    .populate('company', 'name email code isActive approvalStatus')
    .sort({ 'company.name': 1 });
};

/**
 * Static method to find company users
 */
companyUserSchema.statics.findCompanyUsers = function(companyId, options = {}) {
  const query = { company: companyId };
  if (options.status) query.status = options.status;
  if (options.role) query.role = options.role;
  
  return this.find(query)
    .populate('user', 'name email isActive lastLogin twoFAEnabled')
    .populate('approvedBy', 'name email')
    .populate('department', 'name')
    .sort({ 'user.name': 1 });
};

/**
 * Static method to check if user belongs to company
 */
companyUserSchema.statics.userBelongsToCompany = async function(userId, companyId) {
  const association = await this.findOne({ 
    user: userId, 
    company: companyId,
    status: 'active'
  });
  return !!association;
};

const CompanyUser = mongoose.model('CompanyUser', companyUserSchema);

module.exports = CompanyUser;
