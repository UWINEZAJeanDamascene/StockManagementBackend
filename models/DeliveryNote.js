const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// Module 7 - Delivery Note Line Schema
const deliveryNoteLineSchema = new mongoose.Schema({
  invoiceLineId: {
    type: mongoose.Schema.Types.ObjectId,
    // Not required - optional for backwards compatibility
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String
    // Not required - denormalized for reporting
  },
  productCode: String,
  unit: String,
  
  // Legacy field for backwards compatibility
  orderedQty: {
    type: Number,
    min: 0,
    default: 0
  },
  qtyToDeliver: {
    type: Number,
    // Not required - optional for backwards compatibility
    min: 0
  },
  deliveredQty: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingQty: {
    type: Number,
    default: 0,
    min: 0
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryBatch',
    default: null // Required if product.tracking_type = 'batch'
  },
  serialNumbers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockSerialNumber'
  }], // Array of serial_number IDs if tracking_type = 'serial'
  unitCost: {
    type: Number,
    default: 0
  }, // Actual cost consumed - may differ from invoice line estimate
  unitPrice: {
    type: Number,
    default: 0
  }, // Selling price for customer invoice
  lineTotal: {
    type: Number,
    default: 0
  }, // unitPrice * qtyToDeliver
  notes: String
});

// Legacy schema alias for backwards compatibility
const deliveryNoteItemSchema = deliveryNoteLineSchema;

const deliveryNoteSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Delivery note must belong to a company']
  },
  
  // Module 7: Reference number DN-YYYY-NNNNN
  referenceNo: {
    type: String,
    uppercase: true,
    unique: true
  },
  
  // Legacy: keep for backwards compatibility
  deliveryNumber: {
    type: String,
    uppercase: true
  },
  
  // References - Invoice is now optional (new workflow: SO → PickPack → DeliveryNote)
  salesOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder',
    default: null
  },
  pickPack: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PickPack',
    default: null
  },
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null // Changed from required - invoice created after delivery now
  },
  
  // Module 7: Denormalised client for reporting
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  
  // Module 7: Warehouse - NOT NULL
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  
  // Source of delivery - 'pick_pack' for new workflow, 'invoice' for legacy
  sourceType: {
    type: String,
    enum: ['pick_pack', 'invoice', 'manual'],
    default: 'pick_pack'
  },
  
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation',
    default: null
  },
  
  // Supplier (for purchase deliveries - keep for backwards compatibility)
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
  },
  
  // Client details captured at delivery time
  customerTin: String,
  customerName: String,
  customerAddress: String,
  
  // Dates
  deliveryDate: {
    type: Date,
    default: Date.now
  },
  expectedDate: Date,
  receivedDate: Date,
  
  // Delivery details
  deliveredBy: String,
  vehicle: String,
  deliveryAddress: String,
  
  // Module 7: Carrier and tracking
  carrier: {
    type: String,
    default: null
  },
  trackingNo: {
    type: String,
    default: null
  },
  
  // Module 7: Items (renamed from lines for consistency)
  lines: [deliveryNoteLineSchema],
  items: [deliveryNoteItemSchema], // Legacy alias
  
  // Module 7: Status enum - draft, confirmed, dispatched, delivered, cancelled
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'dispatched', 'delivered', 'cancelled'], // Module 7 spec + dispatched + delivered for tracking
    default: 'draft'
  },
  
  // Legacy statuses mapping
  legacyStatus: {
    type: String,
    enum: ['draft', 'dispatched', 'delivered', 'partial', 'failed', 'cancelled'],
    default: 'draft'
  },
  
  // Client confirmation
  receivedBy: String,
  clientSignature: String, // base64 image
  clientStamp: {
    type: Boolean,
    default: false
  },
  
  // Notes
  notes: String,
  
  // Stock tracking
  stockDeducted: {
    type: Boolean,
    default: false
  },
  
  // User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  confirmedDate: Date,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledDate: Date,
  cancellationReason: String
}, {
  timestamps: true
});

// Compound indexes for company + reference
deliveryNoteSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
deliveryNoteSchema.index({ company: 1 });
deliveryNoteSchema.index({ company: 1, status: 1 });
deliveryNoteSchema.index({ quotation: 1 });
deliveryNoteSchema.index({ invoice: 1 }); // Module 7: Important for linking to invoice
deliveryNoteSchema.index({ client: 1 });
deliveryNoteSchema.index({ warehouse: 1 }); // Module 7: For warehouse lookups
deliveryNoteSchema.index({ deliveryDate: 1 });

// Pre-save hook to generate DN-YYYY-NNNNN reference number
deliveryNoteSchema.pre('save', async function(next) {
  // Generate DN-YYYY-NNNNN format for referenceNo
  if (this.isNew && !this.referenceNo) {
    // generateUniqueNumber returns 'DN-YYYY-NNNNN'
    this.referenceNo = await generateUniqueNumber('DN', mongoose.model('DeliveryNote'), this.company, 'referenceNo');
  }
  
  // Legacy: also set deliveryNumber if not set
  if (this.isNew && !this.deliveryNumber) {
    this.deliveryNumber = this.referenceNo;
  }
  
  // Calculate pending qty for each line (for backwards compatibility)
  if (this.lines && this.lines.length > 0) {
    this.lines.forEach(line => {
      if (line.orderedQty !== undefined && line.deliveredQty !== undefined) {
        line.pendingQty = line.orderedQty - line.deliveredQty;
      }
    });
  }
  
  // Legacy items support
  if (this.items && this.items.length > 0) {
    this.items.forEach(item => {
      if (item.orderedQty !== undefined && item.deliveredQty !== undefined) {
        item.pendingQty = item.orderedQty - item.deliveredQty;
      }
    });
  }
  
  next();
});

// Virtual for grand total (based on unitPrice)
deliveryNoteSchema.virtual('grandTotal').get(function() {
  const lineArray = this.lines && this.lines.length > 0 ? this.lines : this.items;
  if (!lineArray || lineArray.length === 0) return 0;
  
  return lineArray.reduce((sum, item) => {
    const qty = item.qtyToDeliver || item.deliveredQty || 0;
    const price = item.unitPrice || 0;
    return sum + (qty * price);
  }, 0);
});

// Calculate totals helper
deliveryNoteSchema.methods.calculateTotals = function() {
  // Use lines array (Module 7) or items (legacy)
  const lineArray = this.lines && this.lines.length > 0 ? this.lines : this.items;
  
  if (!lineArray || lineArray.length === 0) {
    return { totalOrdered: 0, totalDelivered: 0, totalPending: 0 };
  }
  
  const totalOrdered = lineArray.reduce((sum, item) => sum + (item.orderedQty || item.qtyToDeliver || 0), 0);
  const totalDelivered = lineArray.reduce((sum, item) => sum + (item.deliveredQty || 0), 0);
  const totalPending = lineArray.reduce((sum, item) => sum + (item.pendingQty || (item.qtyToDeliver - item.deliveredQty) || 0), 0);
  
  return { totalOrdered, totalDelivered, totalPending };
};

// Virtual for total quantity
deliveryNoteSchema.virtual('totalQuantity').get(function() {
  const { totalOrdered } = this.calculateTotals();
  return totalOrdered;
});

// Ensure virtuals are serialized
deliveryNoteSchema.set('toJSON', { virtuals: true });
deliveryNoteSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('DeliveryNote', deliveryNoteSchema);
