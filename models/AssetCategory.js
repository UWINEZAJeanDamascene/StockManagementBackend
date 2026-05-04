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
    default: '1700' // Default to Fixed Assets (1700-series per chart of accounts)
  },
  defaultAccumDepreciationAccountCode: {
    type: String,
    default: '1810' // Default to Accumulated Depreciation
  },
  defaultDepreciationExpenseAccountCode: {
    type: String,
    default: '5800' // Default to Depreciation Expense
  },

  // Rwanda Revenue Authority (RRA) asset classification
  rraAssetClass: {
    type: String,
    enum: [
      'class_1_buildings',           // 5% straight line (20 years)
      'class_2_improvements',        // 10% straight line (10 years)
      'class_3_plant_machinery',     // 20% declining balance
      'class_4_computers_equipment', // 25% declining balance
      'class_5_motor_vehicles',      // 25% declining balance
      'class_6_furniture_fittings',  // 20% declining balance
      'class_7_intangible',          // Amortization over useful life
      'land_non_depreciable'         // No depreciation
    ],
    default: null
  },

  // RRA tax useful life (may differ from book useful life)
  rraUsefulLifeYears: {
    type: Number,
    default: null
  },

  // RRA tax depreciation method
  rraDepreciationMethod: {
    type: String,
    enum: ['straight_line', 'declining_balance', 'none'],
    default: null
  },

  // RRA declining balance rate (if applicable)
  rraDecliningRate: {
    type: mongoose.Schema.Types.Decimal128,
    default: null
  },

  // Category hierarchy
  parentCategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AssetCategory',
    default: null
  },

  // Category code for reporting
  categoryCode: {
    type: String,
    maxlength: 20,
    default: null
  },

  // Whether this category allows componentization (IFRS)
  isComponentizable: {
    type: Boolean,
    default: false
  },

  // Whether this category is depreciable (false for Land)
  isDepreciable: {
    type: Boolean,
    default: true
  },

  // Depreciation frequency default for this category
  defaultDepreciationFrequency: {
    type: String,
    enum: ['monthly', 'quarterly', 'semi_annually', 'annually'],
    default: 'monthly'
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
  // Rwandan Revenue Authority (RRA) standard asset categories
  const rwaStandardCategories = [
    {
      name: 'Land',
      categoryCode: 'LAND',
      description: 'Land (non-depreciable per RRA and IFRS)',
      isDepreciable: false,
      rraAssetClass: 'land_non_depreciable',
      rraUsefulLifeYears: 0,
      rraDepreciationMethod: 'none',
      defaultUsefulLifeMonths: 0,
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1700',
      defaultAccumDepreciationAccountCode: null,
      defaultDepreciationExpenseAccountCode: null,
      isSystem: true,
      createdBy
    },
    {
      name: 'Buildings & Structures',
      categoryCode: 'BLDG',
      description: 'Buildings, warehouses, factories (RRA Class 1: 5% SL, 20 years)',
      isDepreciable: true,
      rraAssetClass: 'class_1_buildings',
      rraUsefulLifeYears: 20,
      rraDepreciationMethod: 'straight_line',
      defaultUsefulLifeMonths: 240, // 20 years book (IFRS allows longer)
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1710',
      defaultAccumDepreciationAccountCode: '1810',
      defaultDepreciationExpenseAccountCode: '5800',
      isSystem: true,
      createdBy
    },
    {
      name: 'Leasehold Improvements',
      categoryCode: 'LSIMP',
      description: 'Improvements to leased property (RRA Class 2: 10% SL, 10 years)',
      isDepreciable: true,
      rraAssetClass: 'class_2_improvements',
      rraUsefulLifeYears: 10,
      rraDepreciationMethod: 'straight_line',
      defaultUsefulLifeMonths: 120,
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1715',
      defaultAccumDepreciationAccountCode: '1810',
      defaultDepreciationExpenseAccountCode: '5800',
      isSystem: true,
      createdBy
    },
    {
      name: 'Plant & Machinery',
      categoryCode: 'MACH',
      description: 'Production equipment, heavy machinery (RRA Class 3: 20% DB, 5 years)',
      isDepreciable: true,
      rraAssetClass: 'class_3_plant_machinery',
      rraUsefulLifeYears: 5,
      rraDepreciationMethod: 'declining_balance',
      rraDecliningRate: mongoose.Types.Decimal128.fromString('0.20'),
      defaultUsefulLifeMonths: 120, // 10 years book
      defaultDepreciationMethod: 'straight_line',
      defaultDecliningRate: mongoose.Types.Decimal128.fromString('0.20'),
      defaultAssetAccountCode: '1720',
      defaultAccumDepreciationAccountCode: '1811',
      defaultDepreciationExpenseAccountCode: '5801',
      isSystem: true,
      createdBy
    },
    {
      name: 'Computer Equipment & Software',
      categoryCode: 'COMP',
      description: 'Computers, servers, software licenses (RRA Class 4: 25% DB, 4 years)',
      isDepreciable: true,
      rraAssetClass: 'class_4_computers_equipment',
      rraUsefulLifeYears: 4,
      rraDepreciationMethod: 'declining_balance',
      rraDecliningRate: mongoose.Types.Decimal128.fromString('0.25'),
      defaultUsefulLifeMonths: 48, // 4 years
      defaultDepreciationMethod: 'straight_line',
      defaultDecliningRate: mongoose.Types.Decimal128.fromString('0.25'),
      defaultAssetAccountCode: '1725',
      defaultAccumDepreciationAccountCode: '1812',
      defaultDepreciationExpenseAccountCode: '5802',
      isSystem: true,
      createdBy
    },
    {
      name: 'Motor Vehicles',
      categoryCode: 'VEH',
      description: 'Cars, trucks, motorcycles (RRA Class 5: 25% DB, 4 years)',
      isDepreciable: true,
      rraAssetClass: 'class_5_motor_vehicles',
      rraUsefulLifeYears: 4,
      rraDepreciationMethod: 'declining_balance',
      rraDecliningRate: mongoose.Types.Decimal128.fromString('0.25'),
      defaultUsefulLifeMonths: 60, // 5 years book
      defaultDepreciationMethod: 'straight_line',
      defaultDecliningRate: mongoose.Types.Decimal128.fromString('0.25'),
      defaultAssetAccountCode: '1730',
      defaultAccumDepreciationAccountCode: '1813',
      defaultDepreciationExpenseAccountCode: '5803',
      isSystem: true,
      createdBy
    },
    {
      name: 'Office Furniture & Fittings',
      categoryCode: 'FURN',
      description: 'Desks, chairs, cabinets (RRA Class 6: 20% DB, 5 years)',
      isDepreciable: true,
      rraAssetClass: 'class_6_furniture_fittings',
      rraUsefulLifeYears: 5,
      rraDepreciationMethod: 'declining_balance',
      rraDecliningRate: mongoose.Types.Decimal128.fromString('0.20'),
      defaultUsefulLifeMonths: 84, // 7 years book
      defaultDepreciationMethod: 'straight_line',
      defaultDecliningRate: mongoose.Types.Decimal128.fromString('0.20'),
      defaultAssetAccountCode: '1735',
      defaultAccumDepreciationAccountCode: '1814',
      defaultDepreciationExpenseAccountCode: '5804',
      isSystem: true,
      createdBy
    },
    {
      name: 'Intangible Assets',
      categoryCode: 'INTANG',
      description: 'Patents, trademarks, licenses (RRA Class 7: amortize over life)',
      isDepreciable: true,
      rraAssetClass: 'class_7_intangible',
      rraUsefulLifeYears: null, // Varies by asset
      rraDepreciationMethod: 'straight_line',
      defaultUsefulLifeMonths: 60, // 5 years default
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1740',
      defaultAccumDepreciationAccountCode: '1815',
      defaultDepreciationExpenseAccountCode: '5805',
      isSystem: true,
      createdBy
    },
    {
      name: 'Land Improvements',
      categoryCode: 'LDIMP',
      description: 'Parking lots, fencing, landscaping (RRA Class 2: 10% SL, 10 years)',
      isDepreciable: true,
      rraAssetClass: 'class_2_improvements',
      rraUsefulLifeYears: 10,
      rraDepreciationMethod: 'straight_line',
      defaultUsefulLifeMonths: 180, // 15 years
      defaultDepreciationMethod: 'straight_line',
      defaultAssetAccountCode: '1705',
      defaultAccumDepreciationAccountCode: '1810',
      defaultDepreciationExpenseAccountCode: '5800',
      isSystem: true,
      createdBy
    }
  ];

  const created = [];
  for (const cat of rwaStandardCategories) {
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
