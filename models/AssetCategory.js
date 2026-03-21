/**
 * Asset Category Model
 * 
 * Categories for grouping fixed assets for reporting and depreciation defaults.
 * Separate from account codes - allows reporting on asset types even when
 * multiple asset types post to the same ledger account.
 */

const mongoose = require('mongoose');

const assetCategorySchema = new mongoose.Schema({
  // Company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },

  // Category details
  name: {
    type: String,
    required: true,
    maxlength: 100
  },
  description: {
    type: String,
    default: null,
    maxlength: 500
  },

  // Default depreciation settings for this category
  defaultUsefulLifeMonths: {
    type: Number,
    required: true,
    min: 1
  },
  defaultDepreciationMethod: {
    type: String,
    enum: ['straight_line', 'declining_balance'],
    default: 'straight_line'
  },
  defaultDecliningRate: {
    type: mongoose.Schema.Types.Decimal128,
    default: null
  },

  // Default account codes (can be overridden per asset)
  defaultAssetAccountCode: {
    type: String,
    default: '1500' // Default to Fixed Assets
  },
  defaultAccumDepreciationAccountCode: {
    type: String,
    default: '1510' // Default to Accumulated Depreciation
  },
  defaultDepreciationExpenseAccountCode: {
    type: String,
    default: '6050' // Default to Depreciation Expense
  },

  // Whether this is a system category (cannot be deleted)
  isSystem: {
    type: Boolean,
    default: false
  },

  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },

  // Tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
assetCategorySchema.index({ company: 1, name: 1 }, { unique: true });
assetCategorySchema.index({ company: 1, isSystem: 1 });

// Pre-save
assetCategorySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to seed default categories for a company
assetCategorySchema.statics.seedDefaults = async function(companyId, createdBy = null) {
  const defaultCategories = [
    {
      name: 'Buildings',
      description: 'Buildings and structures',
      defaultUsefulLifeMonths: 360, // 30 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1500',
      defaultAccumDepreciationAccountCode: '1510',
      defaultDepreciationExpenseAccountCode: '6050',
      isSystem: true,
      createdBy
    },
    {
      name: 'Vehicles',
      description: 'Cars, trucks, and other vehicles',
      defaultUsefulLifeMonths: 60, // 5 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1510',
      defaultAccumDepreciationAccountCode: '1511',
      defaultDepreciationExpenseAccountCode: '6051',
      isSystem: true,
      createdBy
    },
    {
      name: 'Computer Equipment',
      description: 'Computers, laptops, servers, networking equipment',
      defaultUsefulLifeMonths: 36, // 3 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1520',
      defaultAccumDepreciationAccountCode: '1521',
      defaultDepreciationExpenseAccountCode: '6052',
      isSystem: true,
      createdBy
    },
    {
      name: 'Office Furniture',
      description: 'Desks, chairs, filing cabinets, etc.',
      defaultUsefulLifeMonths: 84, // 7 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1530',
      defaultAccumDepreciationAccountCode: '1531',
      defaultDepreciationExpenseAccountCode: '6053',
      isSystem: true,
      createdBy
    },
    {
      name: 'Machinery',
      description: 'Production and manufacturing equipment',
      defaultUsefulLifeMonths: 120, // 10 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1540',
      defaultAccumDepreciationAccountCode: '1541',
      defaultDepreciationExpenseAccountCode: '6054',
      isSystem: true,
      createdBy
    },
    {
      name: 'Intangible Assets',
      description: 'Patents, trademarks, software licenses',
      defaultUsefulLifeMonths: 60, // 5 years (or shorter based on license)
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1600',
      defaultAccumDepreciationAccountCode: '1601',
      defaultDepreciationExpenseAccountCode: '6055',
      isSystem: true,
      createdBy
    },
    {
      name: 'Land Improvements',
      description: 'Parking lots, landscaping, fencing',
      defaultUsefulLifeMonths: 180, // 15 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1505',
      defaultAccumDepreciationAccountCode: '1506',
      defaultDepreciationExpenseAccountCode: '6056',
      isSystem: true,
      createdBy
    }
  ];

  const created = [];
  for (const cat of defaultCategories) {
    const existing = await this.findOne({ 
      company: companyId, 
      name: cat.name,
      isDeleted: false 
    });
    
    if (!existing) {
      const category = await this.create({
        ...cat,
        company: companyId
      });
      created.push(category);
    }
  }
  
  return created;
};

const AssetCategory = mongoose.model('AssetCategory', assetCategorySchema);

module.exports = AssetCategory;
