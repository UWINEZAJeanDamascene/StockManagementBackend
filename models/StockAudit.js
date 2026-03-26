const mongoose = require('mongoose');

/**
 * StockAuditLine Schema - represents individual product counts in an audit
 * Corresponds to stock_audit_lines table
 */
const stockAuditLineSchema = new mongoose.Schema({
  // Foreign keys - audit reference not required for embedded documents
  audit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockAudit',
    default: null
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  
  // Quantities - using Number for precision (stored as strings in controller)
  // qty_system: Snapshot of qty_on_hand when audit opened — LOCKED, never updated
  qtySystem: {
    type: String,
    required: true,
    default: '0'
  },
  
  // qty_counted: Physically counted — entered by warehouse team
  qtyCounted: {
    type: String,
    default: null
  },
  
  // qty_variance: COMPUTED: qty_counted − qty_system
  qtyVariance: {
    type: String,
    default: '0'
  },
  
  // unit_cost: WAC avg_cost or FIFO weighted avg at time of audit open
  unitCost: {
    type: String,
    default: '0'
  },
  
  // variance_value: COMPUTED: ABS(qty_variance) × unit_cost
  varianceValue: {
    type: String,
    default: '0'
  },
  
  // journal_entry_id: NULL if no variance
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  
  // Notes for this line
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Note: The unique index on stockAuditLine was removed because MongoDB partial indexes
// don't support $ne: null expressions properly. Uniqueness is now enforced at application level.
// For embedded documents, uniqueness per audit is still maintained by the audit reference.
stockAuditLineSchema.index({ audit: 1 });
stockAuditLineSchema.index({ product: 1 });



/**
 * StockAudit Schema - represents a stock audit session
 * Corresponds to stock_audits table
 */
const stockAuditSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Stock audit must belong to a company']
  },
  
  // reference_no: UNIQUE, NOT NULL - AUD-YYYY-NNNNN
  referenceNo: {
    type: String,
    unique: true,
    uppercase: true,
    default: null
  },
  
  // warehouse_id: NOT NULL, FK warehouses
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse is required for stock audit']
  },
  
  // audit_date: NOT NULL
  auditDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  // status: ENUM - draft, counting, posted, cancelled
  status: {
    type: String,
    enum: ['draft', 'counting', 'posted', 'cancelled'],
    default: 'draft',
    required: true
  },
  
  // total_variance_value: NOT NULL, DEFAULT 0
  totalVarianceValue: {
    type: String,
    default: '0'
  },
  
  // notes: NULLABLE
  notes: {
    type: String,
    default: null
  },
  
  // posted_by: NULLABLE, FK users
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // posted_at: NULLABLE
  postedAt: {
    type: Date,
    default: null
  },
  
  // created_by: NOT NULL, FK users
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Type of audit
  type: {
    type: String,
    enum: ['full', 'partial', 'cycle_count', 'spot_check'],
    default: 'cycle_count'
  },
  
  // Category being audited (null means all categories)
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  
  // Items - embedded for simplicity (can also be separate collection)
  items: [stockAuditLineSchema],
  
  // Summary statistics
  totalItems: {
    type: Number,
    default: 0
  },
  itemsCounted: {
    type: Number,
    default: 0
  },
  itemsWithVariance: {
    type: Number,
    default: 0
  },
  
  // Link to aggregated journal entry created for the audit (if any)
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  
  // Approval
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedDate: {
    type: Date,
    default: null
  },
  
  // Dates
  startDate: {
    type: Date,
    default: Date.now
  },
  completedDate: {
    type: Date,
    default: null
  },
  dueDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
stockAuditSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
stockAuditSchema.index({ company: 1, status: 1 });
stockAuditSchema.index({ warehouse: 1, status: 1 });
stockAuditSchema.index({ auditDate: -1 });

// Note: The unique index on embedded items was removed because MongoDB partial indexes
// don't support $ne: null expressions. The uniqueness is now enforced at the application level
// when items are assigned to an audit (audit field is not null).

// Pre-save middleware to generate audit number
stockAuditSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('StockAudit').countDocuments({ 
      company: this.company,
      referenceNo: new RegExp(`^AUD-${year}-`)
    });
    this.referenceNo = `AUD-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Method to calculate summary statistics
stockAuditSchema.methods.calculateSummary = function() {
  if (!this.items || this.items.length === 0) {
    this.totalItems = 0;
    this.itemsCounted = 0;
    this.itemsWithVariance = 0;
    this.totalVarianceValue = '0';
    return this;
  }
  
  this.totalItems = this.items.length;
  this.itemsCounted = this.items.filter(item => item.qtyCounted !== null && item.qtyCounted !== undefined).length;
  
  // Calculate variance items and total variance value
  let totalVariance = 0;
  this.itemsWithVariance = 0;
  
  for (const item of this.items) {
    // Calculate qty_variance = qty_counted - qty_system
    const qtySystem = parseFloat(item.qtySystem) || 0;
    const qtyCounted = parseFloat(item.qtyCounted) || 0;
    const variance = qtyCounted - qtySystem;
    
    // Update qtyVariance in memory
    item.qtyVariance = variance.toString();
    
    if (variance !== 0) {
      this.itemsWithVariance++;
      const unitCost = parseFloat(item.unitCost) || 0;
      const varianceValue = Math.abs(variance) * unitCost;
      totalVariance += varianceValue;
      item.varianceValue = varianceValue.toFixed(2);
    }
  }
  
  this.totalVarianceValue = totalVariance.toFixed(2);
  return this;
};

// Method to add an audit line
stockAuditSchema.methods.addLine = function(productId, qtyCounted, unitCost, notes) {
  const existingItem = this.items.find(item => item.product.toString() === productId.toString());
  
  if (existingItem) {
    existingItem.qtyCounted = qtyCounted;
    const qtySystem = parseFloat(existingItem.qtySystem) || 0;
    const qtyCnt = parseFloat(qtyCounted) || 0;
    existingItem.qtyVariance = (qtyCnt - qtySystem).toString();
    existingItem.unitCost = unitCost;
    const variance = Math.abs(qtyCnt - qtySystem);
    existingItem.varianceValue = (variance * parseFloat(unitCost)).toFixed(2);
    existingItem.notes = notes;
  } else {
    this.items.push({
      product: productId,
      qtySystem: '0', // Should be set when opening audit
      qtyCounted: qtyCounted,
      qtyVariance: qtyCounted, // Will be recalculated when qtySystem is set
      unitCost: unitCost || '0',
      varianceValue: '0',
      notes: notes
    });
  }
  
  this.calculateSummary();
  return this;
};

// Method to populate system quantities from current stock
stockAuditSchema.methods.populateSystemQuantities = async function() {
  const Product = mongoose.model('Product');
  const InventoryBatch = mongoose.model('InventoryBatch');
  
  for (const item of this.items) {
    // Get product's current stock (system quantity)
    const product = await Product.findById(item.product);
    if (product) {
      item.qtySystem = product.currentStock ? product.currentStock.toString() : '0';
      item.unitCost = product.averageCost ? product.averageCost.toString() : '0';
    } else {
      // Check inventory batches
      const batches = await InventoryBatch.find({
        product: item.product,
        warehouse: this.warehouse,
        status: { $nin: ['exhausted'] }
      });
      
      const totalQty = batches.reduce((sum, b) => sum + (b.availableQuantity || 0), 0);
      item.qtySystem = totalQty.toString();
      
      // Calculate weighted average cost
      const totalCost = batches.reduce((sum, b) => sum + ((b.availableQuantity || 0) * parseFloat(b.unitCost || 0)), 0);
      item.unitCost = totalQty > 0 ? (totalCost / totalQty).toFixed(6) : '0';
    }
    
    // Recalculate variance
    const qtySystem = parseFloat(item.qtySystem) || 0;
    const qtyCounted = parseFloat(item.qtyCounted) || 0;
    const variance = qtyCounted - qtySystem;
    item.qtyVariance = variance.toString();
    
    const unitCost = parseFloat(item.unitCost) || 0;
    item.varianceValue = (Math.abs(variance) * unitCost).toFixed(2);
  }
  
  this.calculateSummary();
  return this;
};

// Set toJSON and toObject to handle virtuals
stockAuditSchema.set('toJSON', { virtuals: true, getters: true });
stockAuditSchema.set('toObject', { virtuals: true, getters: true });

const StockAudit = mongoose.model('StockAudit', stockAuditSchema);
const StockAuditLine = mongoose.model('StockAuditLine', stockAuditLineSchema);

module.exports = { StockAudit, StockAuditLine };
