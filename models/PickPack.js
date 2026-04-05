const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');
const decimalTransform = require('./plugins/decimalTransformPlugin');

const pickPackLineSchema = new mongoose.Schema({
  // Reference to Sales Order line
  salesOrderLineId: {
    type: String,
    required: [true, 'Sales order line ID is required']
  },
  // Product being picked
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product is required']
  },
  // Warehouse location
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse is required']
  },
  // Location within warehouse (optional - for large warehouses)
  location: {
    type: String,
    default: null
  },
  // Quantity to pick
  qtyToPick: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Quantity to pick is required'],
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Quantity actually picked
  qtyPicked: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Quantity packed
  qtyPacked: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Batch tracking (if applicable)
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryBatch',
    default: null
  },
  batchNo: {
    type: String,
    default: null
  },
  // Serial numbers (if applicable)
  serialNumbers: [{
    type: String
  }],
  // Unit of measure
  unit: {
    type: String,
    default: 'pcs'
  },
  // Line status
  status: {
    type: String,
    enum: ['pending', 'picking', 'picked', 'packed', 'partial', 'issue'],
    default: 'pending'
  },
  // Picking details
  pickedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pickedAt: Date,
  pickingNotes: String,
  // Packing details
  packedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  packedAt: Date,
  packingNotes: String,
  // Issues during pick/pack
  issues: [{
    type: {
      type: String,
      enum: ['not_found', 'damaged', 'wrong_quantity', 'wrong_product', 'other']
    },
    description: String,
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reportedAt: {
      type: Date,
      default: Date.now
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolution: String
  }]
}, { _id: true });

const pickPackSchema = new mongoose.Schema({
  // Multi-tenancy
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Pick & Pack must belong to a company']
  },
  // Reference number: PK-YYYY-NNNNN
  referenceNo: {
    type: String,
    uppercase: true
  },
  // Link to Sales Order
  salesOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder',
    required: [true, 'Sales Order is required']
  },
  // Client reference (denormalized for convenience)
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client is required']
  },
  // Pick & Pack lines
  lines: [pickPackLineSchema],
  // Status workflow
  status: {
    type: String,
    enum: ['draft', 'picking', 'picked', 'packed', 'ready_for_delivery', 'cancelled'],
    default: 'draft'
  },
  // Warehouse assignment
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse is required']
  },
  // Assigned picker
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedAt: Date,
  // Picking timestamps
  pickingStartedAt: Date,
  pickingCompletedAt: Date,
  // Packing timestamps
  packingStartedAt: Date,
  packingCompletedAt: Date,
  // Priority
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  // Notes
  notes: {
    type: String,
    default: null
  },
  // Packing details
  packageCount: {
    type: Number,
    default: 0
  },
  packageType: {
    type: String,
    enum: ['box', 'pallet', 'envelope', 'crate', 'other'],
    default: 'box'
  },
  totalWeight: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Shipping details (pre-filled from Sales Order)
  shippingMethod: {
    type: String,
    default: null
  },
  trackingNumber: {
    type: String,
    default: null
  },
  // Delivery Note reference (created after packing)
  deliveryNote: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryNote',
    default: null
  },
  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by is required']
  },
  // Cancelled
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledAt: Date,
  cancellationReason: String
}, {
  timestamps: true
});

// Apply decimal transform
pickPackSchema.plugin(decimalTransform, ['qtyToPick', 'qtyPicked', 'qtyPacked', 'totalWeight']);

// Compound index for company + unique PK number
pickPackSchema.index({ company: 1, referenceNo: 1 }, { unique: true });

// Performance indexes
pickPackSchema.index({ company: 1, status: 1 });
pickPackSchema.index({ company: 1, salesOrder: 1 });
pickPackSchema.index({ company: 1, client: 1 });
pickPackSchema.index({ company: 1, assignedTo: 1 });
pickPackSchema.index({ company: 1, warehouse: 1 });
pickPackSchema.index({ status: 1, priority: 1 });

// Auto-generate pick pack number
pickPackSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    this.referenceNo = await generateUniqueNumber('PK', mongoose.model('PickPack'), this.company, 'referenceNo');
  }
  next();
});

// Update Sales Order status when pick/pack status changes
pickPackSchema.pre('save', async function(next) {
  if (this.isModified('status')) {
    const SalesOrder = mongoose.model('SalesOrder');
    const salesOrder = await SalesOrder.findById(this.salesOrder);
    
    if (salesOrder) {
      // Map PickPack status to Sales Order status
      const statusMap = {
        'draft': 'confirmed',
        'picking': 'picking',
        'picked': 'picking',
        'packed': 'packed',
        'ready_for_delivery': 'packed',
        'cancelled': 'confirmed'
      };
      
      if (statusMap[this.status] && salesOrder.canTransitionTo(statusMap[this.status])) {
        salesOrder.status = statusMap[this.status];
        
        // Update packed info
        if (this.status === 'packed') {
          salesOrder.packedBy = this.lines[0]?.packedBy;
          salesOrder.packedDate = new Date();
        }
        
        await salesOrder.save();
      }
    }
  }
  next();
});

// Update line statuses based on quantities
pickPackSchema.pre('save', function(next) {
  for (const line of this.lines) {
    const toPick = line.qtyToPick || 0;
    const picked = line.qtyPicked || 0;
    const packed = line.qtyPacked || 0;
    
    if (line.issues?.length > 0 && !line.issues.every(i => i.resolved)) {
      line.status = 'issue';
    } else if (packed >= toPick && toPick > 0) {
      line.status = 'packed';
    } else if (picked >= toPick && toPick > 0) {
      line.status = 'picked';
    } else if (picked > 0) {
      line.status = 'picking';
    } else {
      line.status = 'pending';
    }
  }
  next();
});

// Method to check if all lines are picked
pickPackSchema.methods.isFullyPicked = function() {
  return this.lines.every(line => (line.qtyPicked || 0) >= (line.qtyToPick || 0));
};

// Method to check if all lines are packed
pickPackSchema.methods.isFullyPacked = function() {
  return this.lines.every(line => (line.qtyPacked || 0) >= (line.qtyToPick || 0));
};

// Method to get pick progress percentage
pickPackSchema.methods.getPickProgress = function() {
  let totalToPick = 0;
  let totalPicked = 0;
  
  for (const line of this.lines) {
    totalToPick += line.qtyToPick || 0;
    totalPicked += line.qtyPicked || 0;
  }
  
  return totalToPick > 0 ? Math.round((totalPicked / totalToPick) * 100) : 0;
};

// Method to get pack progress percentage
pickPackSchema.methods.getPackProgress = function() {
  let totalToPack = 0;
  let totalPacked = 0;
  
  for (const line of this.lines) {
    totalToPack += line.qtyToPick || 0;
    totalPacked += line.qtyPacked || 0;
  }
  
  return totalToPack > 0 ? Math.round((totalPacked / totalToPack) * 100) : 0;
};

// Method to check if can transition to a status
pickPackSchema.methods.canTransitionTo = function(newStatus) {
  const validTransitions = {
    'draft': ['picking', 'cancelled'],
    'picking': ['picked', 'cancelled'],
    'picked': ['packed', 'cancelled'],
    'packed': ['ready_for_delivery', 'cancelled'],
    'ready_for_delivery': ['cancelled'],
    'cancelled': []
  };
  
  return validTransitions[this.status]?.includes(newStatus) || false;
};

// Method to check if editing is allowed (based on status)
pickPackSchema.methods.canEdit = function() {
  return ['draft', 'picking', 'picked', 'packed'].includes(this.status);
};

module.exports = mongoose.model('PickPack', pickPackSchema);
