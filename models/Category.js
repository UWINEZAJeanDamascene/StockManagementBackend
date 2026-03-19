const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Category must belong to a company']
  },
  name: {
    type: String,
    required: [true, 'Please provide a category name'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // Parent category for nesting (max depth 3)
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  // Suggested default account mappings (suggestions only)
  defaultInventoryAccount: {
    type: String
  },
  defaultCogsAccount: {
    type: String
  },
  defaultRevenueAccount: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for company + name (allow duplicates across names)
categorySchema.index({ company: 1, name: 1 });
categorySchema.index({ company: 1 });

// Validate max nesting depth (<= 3 levels)
categorySchema.pre('save', async function(next) {
  try {
    let depth = 1;
    let current = this.parent;
    const Category = mongoose.model('Category');
    while (current) {
      const parentCat = await Category.findById(current).select('parent').lean();
      if (!parentCat) break;
      depth += 1;
      if (depth > 3) {
        const err = new Error('Maximum category nesting depth of 3 exceeded');
        err.name = 'MaxNestingDepth';
        throw err;
      }
      current = parentCat.parent;
    }
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.model('Category', categorySchema);
