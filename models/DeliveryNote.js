const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// Module 7 - Delivery Note Line Schema
const deliveryNoteLineSchema = new mongoose.Schema({
  invoiceLineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice.lines'
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
  
  // References
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation'
  },
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true // Module 7: NOT NULL
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
  
  // Supplier (for purchase deliveries - keep for backwards compatibility)
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
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
  
  // Module 7: Status enum - draft, confirmed, cancelled
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'cancelled'], // Module 7 spec
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
    const year = new Date().getFullYear();
    const DeliveryNote = mongoose.model('DeliveryNote');
    const uniqueNo = await generateUniqueNumber('DN', DeliveryNote, this.company, 'referenceNo');
    this.referenceNo = `${year}-${String(uniqueNo).padStart(5, '0')}`;
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
