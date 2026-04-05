const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');
const decimalTransform = require('./plugins/decimalTransformPlugin');

const salesOrderLineSchema = new mongoose.Schema({
  // Line ID for identification
  lineId: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString()
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product is required for sales order line']
  },
  description: {
    type: String,
    default: null
  },
  // Quantity ordered
  qty: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Quantity is required'],
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: [0.0001, 'Quantity must be greater than 0']
  },
  // Quantity reserved (for stock reservation)
  qtyReserved: {
    type: Number,
    default: 0,
    min: 0
  },
  // Quantity picked
  qtyPicked: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Quantity delivered
  qtyDelivered: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Quantity invoiced
  qtyInvoiced: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: 0
  },
  // Unit of measure
  unit: {
    type: String,
    default: null
  },
  // Selling price
  unitPrice: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Unit price is required'],
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: [0, 'Unit price cannot be negative']
  },
  // Line discount percentage
  discountPct: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: [0, 'Discount percentage cannot be negative'],
    max: [100, 'Discount percentage cannot exceed 100']
  },
  // Tax rate percentage
  taxRate: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString())),
    min: [0, 'Tax rate cannot be negative'],
    max: [100, 'Tax rate cannot exceed 100']
  },
  // Line total: qty × unitPrice × (1 − discountPct/100)
  lineTotal: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Line tax amount
  lineTax: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Warehouse for fulfillment
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    default: null
  },
  // Batch tracking
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryBatch',
    default: null
  },
  // Serial numbers
  serialNumbers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StockSerialNumber'
  }],
  // Line status
  status: {
    type: String,
    enum: ['pending', 'reserved', 'picking', 'picked', 'packed', 'delivered', 'invoiced'],
    default: 'pending'
  },
  // Reference to delivery note lines
  deliveryNoteLines: [{
    deliveryNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote' },
    lineId: String,
    qty: Number
  }],
  // Reference to invoice lines
  invoiceLines: [{
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    lineId: String,
    qty: Number
  }]
}, {
  _id: false
});

const salesOrderSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Sales order must belong to a company']
  },
  // Reference number: SO-YYYY-NNNNN
  referenceNo: {
    type: String,
    uppercase: true
  },
  // Client/Customer
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client is required']
  },
  // Optional: Link to quotation
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation',
    default: null
  },
  // Sales order date
  orderDate: {
    type: Date,
    default: Date.now
  },
  // Expected delivery date
  expectedDate: {
    type: Date,
    default: null
  },
  // Status workflow: draft → confirmed → picking → packed → delivered → invoiced → closed
  //                             ↓
  //                        cancelled
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'picking', 'packed', 'delivered', 'invoiced', 'closed', 'cancelled'],
    default: 'draft'
  },
  // Currency
  currencyCode: {
    type: String,
    required: [true, 'Currency code is required'],
    default: 'USD',
    uppercase: true,
    maxlength: 3
  },
  // Exchange rate to company base currency
  exchangeRate: {
    type: mongoose.Schema.Types.Decimal128,
    default: 1,
    get: v => (v == null ? 1 : parseFloat(v.toString())),
    min: [0.000001, 'Exchange rate must be positive']
  },
  // Sales order lines
  lines: [salesOrderLineSchema],
  // Subtotal (before tax)
  subtotal: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Total discount amount
  totalDiscount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Total tax amount
  taxAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Grand total
  totalAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: v => (v == null ? 0 : parseFloat(v.toString()))
  },
  // Fulfillment tracking
  fulfillmentStatus: {
    type: String,
    enum: ['not_started', 'partial', 'complete'],
    default: 'not_started'
  },
  // Percentage fulfilled (0-100)
  fulfillmentPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  // Delivery address (may differ from client address)
  deliveryAddress: {
    type: String,
    default: null
  },
  // Shipping method
  shippingMethod: {
    type: String,
    default: null
  },
  // Terms and conditions
  terms: {
    type: String,
    default: null
  },
  // Additional notes
  notes: {
    type: String,
    default: null
  },
  // Store company and client TINs for PDF/printing convenience
  companyTin: String,
  clientTin: String,
  // References to related documents
  deliveryNotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryNote'
  }],
  invoices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  }],
  // Pick & Pack reference
  pickPackId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PickPack',
    default: null
  },
  // Created by user
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user is required']
  },
  // Confirmed by user
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  confirmedDate: Date,
  // Packed by user
  packedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  packedDate: Date,
  // Delivered by user
  deliveredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deliveredDate: Date,
  // Invoiced by user
  invoicedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  invoicedDate: Date,
  // Cancelled by user
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledDate: Date,
  cancellationReason: String,
  // Stock reservation tracking
  stockReserved: {
    type: Boolean,
    default: false
  },
  reservationDate: Date,
  // Whether this is a backorder
  isBackorder: {
    type: Boolean,
    default: false
  },
  // Link to parent sales order if this is a backorder
  parentOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder',
    default: null
  },
  backorderItems: [{
    lineId: String,
    remainingQty: Number,
    reason: String
  }]
}, {
  timestamps: true
});

// Apply decimal transform plugin
salesOrderSchema.plugin(decimalTransform, ['qty', 'qtyReserved', 'qtyPicked', 'qtyDelivered', 'qtyInvoiced', 'unitPrice', 'discountPct', 'taxRate', 'lineTotal', 'lineTax', 'subtotal', 'totalDiscount', 'taxAmount', 'totalAmount', 'exchangeRate']);

// Compound index for company + unique SO number
salesOrderSchema.index({ company: 1, referenceNo: 1 }, { unique: true });

// Performance indexes
salesOrderSchema.index({ company: 1, status: 1 });
salesOrderSchema.index({ company: 1, client: 1 });
salesOrderSchema.index({ company: 1, orderDate: -1 });
salesOrderSchema.index({ company: 1, expectedDate: 1 });
salesOrderSchema.index({ quotation: 1 });
salesOrderSchema.index({ status: 1, fulfillmentStatus: 1 });

// Calculate line totals and order totals before saving
salesOrderSchema.pre('save', function(next) {
  const lines = this.lines || [];
  
  if (lines.length > 0) {
    let subtotalVal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    
    lines.forEach(line => {
      const qty = line.qty || 0;
      const unitPrice = line.unitPrice || 0;
      const discountPct = line.discountPct || 0;
      const taxRate = line.taxRate || 0;
      
      const lineSubtotal = qty * unitPrice;
      const lineDiscount = lineSubtotal * (discountPct / 100);
      const netAmount = lineSubtotal - lineDiscount;
      const lineTax = netAmount * (taxRate / 100);
      const lineTotal = netAmount + lineTax;
      
      line.lineTotal = lineTotal;
      line.lineTax = lineTax;
      
      subtotalVal += lineSubtotal;
      totalDiscount += lineDiscount;
      totalTax += lineTax;
    });
    
    const grandTotal = subtotalVal - totalDiscount + totalTax;
    
    this.subtotal = mongoose.Types.Decimal128.fromString(subtotalVal.toFixed(2));
    this.totalDiscount = mongoose.Types.Decimal128.fromString(totalDiscount.toFixed(2));
    this.taxAmount = mongoose.Types.Decimal128.fromString(totalTax.toFixed(2));
    this.totalAmount = mongoose.Types.Decimal128.fromString(grandTotal.toFixed(2));
    
    // Calculate fulfillment percentage
    let totalQty = 0;
    let totalDelivered = 0;
    lines.forEach(line => {
      totalQty += line.qty || 0;
      totalDelivered += line.qtyDelivered || 0;
    });
    
    if (totalQty > 0) {
      this.fulfillmentPercent = Math.round((totalDelivered / totalQty) * 100);
      if (this.fulfillmentPercent === 0) {
        this.fulfillmentStatus = 'not_started';
      } else if (this.fulfillmentPercent === 100) {
        this.fulfillmentStatus = 'complete';
      } else {
        this.fulfillmentStatus = 'partial';
      }
    }
  }
  
  next();
});

// Auto-generate sales order number - SO-YYYY-NNNNN format
salesOrderSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    this.referenceNo = await generateUniqueNumber('SO', mongoose.model('SalesOrder'), this.company, 'referenceNo');
  }
  next();
});

// Method to check if can transition to a status
salesOrderSchema.methods.canTransitionTo = function(newStatus) {
  const validTransitions = {
    'draft': ['confirmed', 'cancelled'],
    'confirmed': ['picking', 'cancelled'],
    'picking': ['packed', 'cancelled'],
    'packed': ['delivered', 'cancelled'],
    'delivered': ['invoiced', 'closed'],
    'invoiced': ['closed'],
    'closed': [],
    'cancelled': []
  };
  
  return validTransitions[this.status]?.includes(newStatus) || false;
};

// Method to get remaining quantity to deliver
salesOrderSchema.methods.getRemainingQty = function() {
  return this.lines.map(line => ({
    lineId: line.lineId,
    product: line.product,
    remainingQty: (line.qty || 0) - (line.qtyDelivered || 0)
  })).filter(item => item.remainingQty > 0);
};

// Method to get remaining quantity to invoice
salesOrderSchema.methods.getRemainingQtyToInvoice = function() {
  return this.lines.map(line => ({
    lineId: line.lineId,
    product: line.product,
    remainingQty: (line.qtyDelivered || 0) - (line.qtyInvoiced || 0)
  })).filter(item => item.remainingQty > 0);
};

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
