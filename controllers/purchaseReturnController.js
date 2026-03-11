const PurchaseReturn = require('../models/PurchaseReturn');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Purchase = require('../models/Purchase');

// @desc    Get all purchase returns for a company
// @route   GET /api/purchase-returns
// @access  Private
exports.getPurchaseReturns = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { supplierId, status, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    const query = { company: companyId };
    
    if (supplierId) {
      query.supplier = supplierId;
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (startDate || endDate) {
      query.returnDate = {};
      if (startDate) query.returnDate.$gte = new Date(startDate);
      if (endDate) query.returnDate.$lte = new Date(endDate);
    }
    
    const purchaseReturns = await PurchaseReturn.find(query)
      .populate('supplier', 'name code')
      .populate('purchase', 'purchaseNumber')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ returnDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await PurchaseReturn.countDocuments(query);
    
    res.json({
      success: true,
      count: purchaseReturns.length,
      total,
      pages: Math.ceil(total / limit),
      data: purchaseReturns
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single purchase return
// @route   GET /api/purchase-returns/:id
// @access  Private
exports.getPurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: req.params.id,
      company: companyId
    })
      .populate('supplier', 'name code contact')
      .populate('purchase', 'purchaseNumber')
      .populate('items.product', 'name sku unit averageCost')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email');
    
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }
    
    res.json({
      success: true,
      data: purchaseReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new purchase return
// @route   POST /api/purchase-returns
// @access  Private
exports.createPurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    // If linking to a purchase, check if it exists and get payment status
    let originalPurchasePaid = false;
    let originalPurchasePaymentDate = null;
    
    let computedTotalTax = req.body.totalTax || 0;

    if (req.body.purchase) {
      const purchase = await Purchase.findOne({
        _id: req.body.purchase,
        company: companyId
      });
      
      if (purchase) {
        originalPurchasePaid = purchase.status === 'paid';
        if (purchase.payments && purchase.payments.length > 0) {
          const paidPayments = purchase.payments.filter(p => p.status === 'completed');
          if (paidPayments.length > 0) {
            originalPurchasePaymentDate = paidPayments[paidPayments.length - 1].paidDate;
          }
        }

        // Auto-compute totalTax if frontend didn't supply it (or sent 0)
        // Use proportional calculation: (returnSubtotal / purchaseSubtotal) * purchaseTotalTax
        if (computedTotalTax === 0 && purchase.subtotal > 0 && purchase.totalTax > 0) {
          const returnSubtotal = req.body.subtotal || 0;
          computedTotalTax = (returnSubtotal / purchase.subtotal) * purchase.totalTax;
        }
      }
    }
    
    const purchaseReturn = new PurchaseReturn({
      ...req.body,
      totalTax: computedTotalTax,
      company: companyId,
      createdBy: req.user._id,
      originalPurchasePaid,
      originalPurchasePaymentDate
    });
    
    await purchaseReturn.save();
    
    res.status(201).json({
      success: true,
      data: purchaseReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update purchase return
// @route   PUT /api/purchase-returns/:id
// @access  Private
exports.updatePurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    let purchaseReturn = await PurchaseReturn.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }
    
    // Don't allow changing company, createdBy, or approved status if already approved
    const { company, createdBy, approvedBy, ...updateData } = req.body;
    
    // If changing purchase link, re-check payment status
    if (updateData.purchase && updateData.purchase !== purchaseReturn.purchase?.toString()) {
      const purchase = await Purchase.findOne({
        _id: updateData.purchase,
        company: companyId
      });
      
      if (purchase) {
        updateData.originalPurchasePaid = purchase.status === 'paid';
        if (purchase.payments && purchase.payments.length > 0) {
          const paidPayments = purchase.payments.filter(p => p.status === 'completed');
          if (paidPayments.length > 0) {
            updateData.originalPurchasePaymentDate = paidPayments[paidPayments.length - 1].paidDate;
          }
        }
      }
    }
    
    Object.assign(purchaseReturn, updateData);
    await purchaseReturn.save();
    
    res.json({
      success: true,
      data: purchaseReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve purchase return
// @route   PUT /api/purchase-returns/:id/approve
// @access  Private
exports.approvePurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }
    
    if (purchaseReturn.status !== 'draft' && purchaseReturn.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only draft or pending purchase returns can be approved' 
      });
    }
    
    // Create stock movements for each returned item (out to supplier)
    for (const item of purchaseReturn.items) {
      // Update product stock first so we can record previousStock / newStock
      const product = await Product.findById(item.product);
      const previousStock = product ? (product.currentStock || 0) : 0;
      const newStock = Math.max(0, previousStock - item.quantity);

      const stockMovement = new StockMovement({
        company: companyId,
        product: item.product,
        type: 'out',
        reason: 'return',
        referenceNumber: purchaseReturn.purchaseReturnNumber,
        referenceType: 'return',
        quantity: item.quantity,
        previousStock,
        newStock,
        unitCost: item.unitPrice,
        totalCost: item.total,
        supplier: purchaseReturn.supplier,
        movementDate: purchaseReturn.returnDate,
        performedBy: req.user._id,
        notes: `Purchase return to supplier: ${purchaseReturn.purchaseReturnNumber}`
      });
      
      await stockMovement.save();
      
      if (product) {
        product.currentStock = newStock;
        await product.save();
      }
    }
    
    // Reduce Accounts Payable if applicable
    if (purchaseReturn.accountsPayableReduction > 0 && purchaseReturn.purchase) {
      const purchase = await Purchase.findById(purchaseReturn.purchase);
      if (purchase && purchase.status !== 'paid') {
        // Reduce the balance
        purchase.balance -= purchaseReturn.accountsPayableReduction;
        if (purchase.balance < 0) purchase.balance = 0;
        await purchase.save();
      }
    }
    
    // Update purchase return status
    purchaseReturn.status = 'approved';
    purchaseReturn.approvedBy = req.user._id;
    await purchaseReturn.save();
    
    res.json({
      success: true,
      message: 'Purchase return approved and stock updated',
      data: purchaseReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record refund from supplier
// @route   PUT /api/purchase-returns/:id/refund
// @access  Private
exports.recordRefund = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { refundAmount, refundMethod } = req.body;
    
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }
    
    if (purchaseReturn.status !== 'approved') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only approved purchase returns can have refunds recorded' 
      });
    }
    
    // Update refund info
    purchaseReturn.refundAmount = refundAmount || purchaseReturn.grandTotal;
    purchaseReturn.refundMethod = refundMethod || 'bank_transfer';
    purchaseReturn.refunded = true;
    purchaseReturn.refundDate = new Date();
    
    // If partially refunded
    if (refundAmount < purchaseReturn.grandTotal) {
      purchaseReturn.status = 'partially_refunded';
    } else {
      purchaseReturn.status = 'refunded';
    }
    
    await purchaseReturn.save();
    
    res.json({
      success: true,
      message: 'Refund recorded successfully',
      data: purchaseReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete (cancel) purchase return
// @route   DELETE /api/purchase-returns/:id
// @access  Private
exports.deletePurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }
    
    // Only allow cancelling draft or pending returns
    if (purchaseReturn.status !== 'draft' && purchaseReturn.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only draft or pending purchase returns can be cancelled' 
      });
    }
    
    // Soft delete - mark as cancelled
    purchaseReturn.status = 'cancelled';
    await purchaseReturn.save();
    
    res.json({
      success: true,
      message: 'Purchase return cancelled'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get purchase return summary
// @route   GET /api/purchase-returns/summary
// @access  Private
exports.getPurchaseReturnSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    const match = {
      company: companyId,
      status: { $in: ['approved', 'refunded', 'partially_refunded'] }
    };
    
    if (startDate || endDate) {
      match.returnDate = {};
      if (startDate) match.returnDate.$gte = new Date(startDate);
      if (endDate) match.returnDate.$lte = new Date(endDate);
    }
    
    const summary = await PurchaseReturn.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalReturns: { $sum: '$grandTotal' },
          totalTax: { $sum: '$totalTax' },
          totalRefunded: { $sum: '$refundAmount' },
          totalAPReduction: { $sum: '$accountsPayableReduction' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const result = {
      totalReturns: summary[0]?.totalReturns || 0,
      totalTax: summary[0]?.totalTax || 0,
      totalRefunded: summary[0]?.totalRefunded || 0,
      totalAPReduction: summary[0]?.totalAPReduction || 0,
      count: summary[0]?.count || 0
    };
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
