const mongoose = require('mongoose');

const fixedAssetSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Fixed asset must belong to a company']
  },
  name: {
    type: String,
    required: [true, 'Please provide asset name'],
    trim: true
  },
  assetCode: {
    type: String,
    uppercase: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['equipment', 'furniture', 'vehicles', 'buildings', 'land', 'computers', 'machinery', 'other'],
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  // Purchase/acquisition details
  purchaseDate: {
    type: Date,
    required: true
  },
  purchaseCost: {
    type: Number,
    required: true,
    min: 0
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  invoiceNumber: String,
  
  // Depreciation settings
  usefulLifeYears: {
    type: Number,
    required: true,
    min: 1
  },
  depreciationMethod: {
    type: String,
    enum: ['straight-line', 'declining-balance', 'sum-of-years'],
    default: 'straight-line'
  },
  salvageValue: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Current status
  status: {
    type: String,
    enum: ['active', 'disposed', 'fully-depreciated'],
    default: 'active'
  },
  location: String,
  serialNumber: String,
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

// Compound index for company + unique asset code
fixedAssetSchema.index({ company: 1, assetCode: 1 }, { unique: true });
fixedAssetSchema.index({ company: 1 });

// Virtual for calculating accumulated depreciation
fixedAssetSchema.virtual('accumulatedDepreciation').get(function() {
  if (!this.purchaseDate || !this.purchaseCost) return 0;
  
  const now = new Date();
  const yearsOwned = (now - this.purchaseDate) / (365.25 * 24 * 60 * 60 * 1000);
  const yearsUsed = Math.min(yearsOwned, this.usefulLifeYears);
  
  switch (this.depreciationMethod) {
    case 'straight-line':
      const annualDepreciation = (this.purchaseCost - this.salvageValue) / this.usefulLifeYears;
      return Math.min(annualDepreciation * yearsUsed, this.purchaseCost - this.salvageValue);
    
    case 'declining-balance':
      const rate = 2 / this.usefulLifeYears; // Double declining balance
      let accumulated = 0;
      let bookValue = this.purchaseCost;
      for (let i = 0; i < Math.floor(yearsUsed); i++) {
        const depreciation = bookValue * rate;
        accumulated += depreciation;
        bookValue -= depreciation;
      }
      // Partial year for declining balance
      const decliningPartial = yearsUsed % 1;
      if (decliningPartial > 0) {
        accumulated += bookValue * rate * decliningPartial;
      }
      return Math.min(accumulated, this.purchaseCost - this.salvageValue);
    
    case 'sum-of-years':
      const sumOfYears = (this.usefulLifeYears * (this.usefulLifeYears + 1)) / 2;
      let sumAccumulated = 0;
      const fullYears = Math.floor(yearsUsed);
      for (let i = 0; i < fullYears; i++) {
        const remainingLife = this.usefulLifeYears - i;
        const yearlyDepreciation = ((this.purchaseCost - this.salvageValue) * remainingLife) / sumOfYears;
        sumAccumulated += yearlyDepreciation;
      }
      // Partial year for sum-of-years
      const sumOfYearsPartial = yearsUsed % 1;
      if (sumOfYearsPartial > 0) {
        const remainingLife = this.usefulLifeYears - fullYears;
        sumAccumulated += ((this.purchaseCost - this.salvageValue) * remainingLife) / sumOfYears * sumOfYearsPartial;
      }
      return Math.min(sumAccumulated, this.purchaseCost - this.salvageValue);
    
    default:
      return 0;
  }
});

// Virtual for net book value
fixedAssetSchema.virtual('netBookValue').get(function() {
  return this.purchaseCost - (this.accumulatedDepreciation || 0);
});

// Virtual for annual depreciation expense
fixedAssetSchema.virtual('annualDepreciation').get(function() {
  switch (this.depreciationMethod) {
    case 'straight-line':
      return (this.purchaseCost - this.salvageValue) / this.usefulLifeYears;
    default:
      return (this.purchaseCost - this.salvageValue) / this.usefulLifeYears;
  }
});

fixedAssetSchema.set('toJSON', { virtuals: true });
fixedAssetSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FixedAsset', fixedAssetSchema);
