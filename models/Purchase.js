const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

const decimalDefault = (s) => () => mongoose.Types.Decimal128.fromString(s);

const purchaseItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  itemCode: String,
  description: String,
  quantity: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: decimalDefault('0.0000')
  },
  unit: String,
  unitCost: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: decimalDefault('0.000000')
  },
  discount: {
    type: mongoose.Schema.Types.Decimal128,
    default: decimalDefault('0.00')
  },
  taxCode: {
    type: String,
    enum: ['A', 'B', 'None'],
    default: 'A'
  },
  taxRate: {
    type: mongoose.Schema.Types.Decimal128,
    default: decimalDefault('0.000000')
  },
  taxAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: decimalDefault('0.00')
  },
  subtotal: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: decimalDefault('0.00')
  },
  totalWithTax: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: decimalDefault('0.00')
  },

  // Warehouse for this line item (if different from header warehouse)
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    default: null
  },

  // Stock tracking fields
  trackingType: {
    type: String,
    enum: ['none', 'batch', 'serial'],
    default: 'none'
  },
  batchNo: String,
  serialNumber: String,
  manufactureDate: Date,
  expiryDate: Date,
  serialNumbers: [String], // For multiple serial numbers when quantity > 1

  // Budget tracking
  budgetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Budget',
    default: null
  },
  budget_line_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetLine',
    default: null
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  encumbrance_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Encumbrance',
    default: null
  }
});

const purchasePaymentSchema = new mongoose.Schema({
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: decimalDefault('0.00')
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'bank_transfer', 'cheque', 'mobile_money', 'credit'],
    required: true
  },
  reference: String,
  paidDate: {
    type: Date,
    default: Date.now
  },
  notes: String,
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const purchaseSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Purchase must belong to a company']
  },
  purchaseNumber: {
    type: String,
    uppercase: true
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  // Supplier details captured at purchase time
  supplierTin: String,
  supplierName: String,
  supplierAddress: String,

  // Invoice from supplier
  supplierInvoiceNumber: String,
  supplierInvoiceDate: Date,

  // Warehouse for the purchase (default warehouse for all items)
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    default: null
  },

  // Status
  status: {
    type: String,
    enum: ['draft', 'ordered', 'received', 'partial', 'paid', 'cancelled'],
    default: 'draft'
  },

  // Currency and payment terms
  currency: {
    type: String,
    default: 'FRW'
  },
  paymentTerms: {
    type: String,
    enum: ['cash', 'credit_7', 'credit_15', 'credit_30', 'credit_45', 'credit_60'],
    default: 'cash'
  },

  items: [purchaseItemSchema],

  // Tax breakdown
  totalAEx: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  totalB18: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  totalTaxA: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  totalTaxB: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },

  // Legacy totals
  subtotal: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  totalDiscount: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  totalTax: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  grandTotal: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  roundedAmount: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },

  // Backwards-compatible field names expected by some consumers
  taxAmount: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  discount: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  total: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },

  // Payment tracking
  amountPaid: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  balance: { type: mongoose.Schema.Types.Decimal128, default: decimalDefault('0.00') },
  payments: [purchasePaymentSchema],

  // Dates
  expectedDeliveryDate: Date,
  purchaseDate: { type: Date, default: Date.now },
  receivedDate: Date,
  terms: String,
  notes: String,

  // Stock tracking
  stockAdded: { type: Boolean, default: false },

  // Budget tracking (for encumbrance)
  budgetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Budget',
    default: null
  },
  budget_line_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetLine',
    default: null
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },

  // User tracking
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  paidDate: Date,
  confirmedDate: Date,
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledDate: Date,
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancellationReason: String,
}, {
  timestamps: true
});

// Compound index for company + unique purchase number
purchaseSchema.index({ company: 1, purchaseNumber: 1 }, { unique: true });
purchaseSchema.index({ company: 1 });

// Performance indexes for reports
purchaseSchema.index({ company: 1, status: 1 });
purchaseSchema.index({ company: 1, purchaseDate: 1 });
purchaseSchema.index({ company: 1, supplier: 1 });
purchaseSchema.index({ 'payments.paidDate': 1 });

// Auto-generate purchase number
purchaseSchema.pre('save', async function(next) {
  if (this.isNew && !this.purchaseNumber) {
    this.purchaseNumber = await generateUniqueNumber('PO', mongoose.model('Purchase'), this.company, 'purchaseNumber');
  }
  next();
});

// Calculate totals before saving
purchaseSchema.pre('save', function(next) {
  try {
    if (this.items && this.items.length > 0) {
      let totalAEx = 0;
      let totalB18 = 0;
      let totalTaxA = 0;
      let totalTaxB = 0;

      this.items.forEach(item => {
        const qty = item.quantity && item.quantity.toString ? parseFloat(item.quantity.toString()) : Number(item.quantity || 0);
        const unitCost = item.unitCost && item.unitCost.toString ? parseFloat(item.unitCost.toString()) : Number(item.unitCost || 0);
        const itemDiscount = item.discount && item.discount.toString ? parseFloat(item.discount.toString()) : Number(item.discount || 0);
        const taxRate = item.taxRate && item.taxRate.toString ? parseFloat(item.taxRate.toString()) : Number(item.taxRate || 0);

        const itemSubtotalNum = qty * unitCost;
        const netAmount = itemSubtotalNum - itemDiscount;
        const itemTaxNum = netAmount * (taxRate / 100);
        const itemTotalNum = netAmount + itemTaxNum;

        if (item.taxCode === 'A') {
          totalAEx += netAmount;
          totalTaxA += itemTaxNum;
        } else if (item.taxCode === 'B') {
          totalB18 += netAmount;
          totalTaxB += itemTaxNum;
        }

        item.subtotal = mongoose.Types.Decimal128.fromString(itemSubtotalNum.toFixed(2));
        item.taxAmount = mongoose.Types.Decimal128.fromString(itemTaxNum.toFixed(2));
        item.totalWithTax = mongoose.Types.Decimal128.fromString(itemTotalNum.toFixed(2));
      });

      this.totalAEx = mongoose.Types.Decimal128.fromString(totalAEx.toFixed(2));
      this.totalB18 = mongoose.Types.Decimal128.fromString(totalB18.toFixed(2));
      this.totalTaxA = mongoose.Types.Decimal128.fromString(totalTaxA.toFixed(2));
      this.totalTaxB = mongoose.Types.Decimal128.fromString(totalTaxB.toFixed(2));

      const subtotalNum = this.items.reduce((sum, item) => {
        const v = item.subtotal && item.subtotal.toString ? parseFloat(item.subtotal.toString()) : Number(item.subtotal || 0);
        return sum + (isFinite(v) ? v : 0);
      }, 0);
      const totalDiscountNum = this.items.reduce((sum, item) => {
        const v = item.discount && item.discount.toString ? parseFloat(item.discount.toString()) : Number(item.discount || 0);
        return sum + (isFinite(v) ? v : 0);
      }, 0);

      const totalTaxNum = parseFloat((parseFloat(totalTaxA) || 0) + (parseFloat(totalTaxB) || 0));
      const grandTotalNum = subtotalNum - totalDiscountNum + (parseFloat(totalTaxA) || 0) + (parseFloat(totalTaxB) || 0);

      this.subtotal = mongoose.Types.Decimal128.fromString(subtotalNum.toFixed(2));
      this.totalDiscount = mongoose.Types.Decimal128.fromString(totalDiscountNum.toFixed(2));
      this.totalTax = mongoose.Types.Decimal128.fromString(((parseFloat(totalTaxA) || 0) + (parseFloat(totalTaxB) || 0)).toFixed(2));
      this.grandTotal = mongoose.Types.Decimal128.fromString(grandTotalNum.toFixed(2));
      this.roundedAmount = mongoose.Types.Decimal128.fromString((Math.round(grandTotalNum * 100) / 100).toFixed(2));

      const roundedAmountNum = parseFloat(this.roundedAmount.toString());
      const amountPaidNum = this.amountPaid && this.amountPaid.toString ? parseFloat(this.amountPaid.toString()) : Number(this.amountPaid || 0);
      const balanceNum = roundedAmountNum - amountPaidNum;
      this.balance = mongoose.Types.Decimal128.fromString(balanceNum.toFixed(2));
    }

    // Update status based on payment
    const roundedNum = this.roundedAmount && this.roundedAmount.toString ? parseFloat(this.roundedAmount.toString()) : Number(this.roundedAmount || 0);
    const paidNum = this.amountPaid && this.amountPaid.toString ? parseFloat(this.amountPaid.toString()) : Number(this.amountPaid || 0);
    if (paidNum >= roundedNum && roundedNum > 0) {
      this.status = 'paid';
      if (!this.paidDate) {
        this.paidDate = new Date();
      }
    } else if (paidNum > 0 && paidNum < roundedNum) {
      this.status = 'partial';
    }

    // Backwards-compatible aliases (store as Decimal128)
    this.taxAmount = this.totalTax;
    this.discount = this.totalDiscount;
    this.total = this.roundedAmount || this.grandTotal;

    next();
  } catch (err) {
    return next(err);
  }
});

// Ensure Decimal128 fields serialize as strings in JSON
purchaseSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const toMoney = (val) => {
      if (val == null) return '0.00';
      try { return parseFloat(val.toString()).toFixed(2); } catch (e) { return String(val); }
    };
    const toQty = (val) => {
      if (val == null) return '0.0000';
      try { return parseFloat(val.toString()).toFixed(4); } catch (e) { return String(val); }
    };
    const toUnitCost = (val) => {
      if (val == null) return '0.000000';
      try { return parseFloat(val.toString()).toFixed(6); } catch (e) { return String(val); }
    };

    if (Array.isArray(ret.items)) {
      ret.items = ret.items.map(it => ({
        product: it.product,
        itemCode: it.itemCode,
        description: it.description,
        quantity: toQty(it.quantity),
        unit: it.unit,
        unitCost: toUnitCost(it.unitCost),
        discount: toMoney(it.discount),
        taxCode: it.taxCode,
        taxRate: (it.taxRate == null) ? '0.000000' : parseFloat(it.taxRate.toString()).toFixed(6),
        taxAmount: toMoney(it.taxAmount),
        subtotal: toMoney(it.subtotal),
        totalWithTax: toMoney(it.totalWithTax)
      }));
    }

    if (ret.subtotal !== undefined) ret.subtotal = toMoney(ret.subtotal);
    if (ret.totalDiscount !== undefined) ret.totalDiscount = toMoney(ret.totalDiscount);
    if (ret.totalTax !== undefined) ret.totalTax = toMoney(ret.totalTax);
    if (ret.grandTotal !== undefined) ret.grandTotal = toMoney(ret.grandTotal);
    if (ret.roundedAmount !== undefined) ret.roundedAmount = toMoney(ret.roundedAmount);
    if (ret.amountPaid !== undefined) ret.amountPaid = toMoney(ret.amountPaid);
    if (ret.balance !== undefined) ret.balance = toMoney(ret.balance);

    if (ret.totalAEx !== undefined) ret.totalAEx = toMoney(ret.totalAEx);
    if (ret.totalB18 !== undefined) ret.totalB18 = toMoney(ret.totalB18);
    if (ret.totalTaxA !== undefined) ret.totalTaxA = toMoney(ret.totalTaxA);
    if (ret.totalTaxB !== undefined) ret.totalTaxB = toMoney(ret.totalTaxB);

    // Handle payments array - convert Decimal128 amounts to strings
    if (Array.isArray(ret.payments)) {
      ret.payments = ret.payments.map(payment => ({
        ...payment,
        amount: toMoney(payment.amount)
      }));
    }

    return ret;
  }
});

// Convert Decimal128 results to JS numbers for compatibility with tests and lean queries
const decimalTransform = require('./plugins/decimalTransformPlugin');
purchaseSchema.plugin(decimalTransform);
module.exports = mongoose.model('Purchase', purchaseSchema);
