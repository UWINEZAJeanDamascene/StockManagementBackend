const mongoose = require('mongoose');
const PurchaseReturn = require('../models/PurchaseReturn');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const InventoryBatch = require('../models/InventoryBatch');
const StockMovement = require('../models/StockMovement');
const Product = require('../models/Product');
const JournalService = require('../services/journalService');
const transactionService = require('../services/transactionService');
const PurchaseOrder = require('../models/PurchaseOrder');
const DEFAULT_ACCOUNTS = require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS;
const { parsePagination, paginationMeta } = require('../utils/pagination');

exports.createPurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const payload = req.body;
    payload.company = companyId;
    payload.createdBy = req.user.id;
    payload.status = payload.status || 'draft';

    // Validate GRN exists and is confirmed
    const grn = await GoodsReceivedNote.findOne({ _id: payload.grn, company: companyId });
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    if (grn.status !== 'confirmed') return res.status(409).json({ success: false, message: 'Can only return against confirmed GRN' });

    const pr = await PurchaseReturn.create(payload);
    res.status(201).json({ success: true, data: pr });
  } catch (err) { next(err); }
};

exports.updatePurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const pr = await PurchaseReturn.findOne({ _id: req.params.id, company: companyId });
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
    if (pr.status !== 'draft') return res.status(409).json({ success: false, message: 'Only draft returns can be edited' });

    Object.assign(pr, req.body);
    await pr.save();
    res.json({ success: true, data: pr });
  } catch (err) { next(err); }
};

// Confirm purchase return
exports.confirmPurchaseReturn = async (req, res, next) => {
  const companyId = req.user.company._id;

  const doConfirm = async (sess) => {
    const useSession = !!sess;
    const opts = useSession ? { session: sess } : {};

    const pr = await PurchaseReturn.findOne({ _id: req.params.id, company: companyId }, null, opts);
    if (!pr) {
      throw Object.assign(new Error('Purchase return not found'), { status: 404 });
    }
    if (pr.status === 'confirmed') throw Object.assign(new Error('Purchase return already confirmed'), { status: 400 });

    // Load GRN
    const grn = await GoodsReceivedNote.findOne({ _id: pr.grn, company: companyId }).session(sess);
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });
    if (grn.status !== 'confirmed') throw Object.assign(new Error('Cannot return against unconfirmed GRN'), { status: 409 });

    // Track created resources for manual rollback
    const createdMovements = [];
    const modifiedBatches = [];
    const modifiedProducts = new Map();

    let totalReturnNet = 0;
    let totalReturnTax = 0;

    for (const line of pr.lines) {
      const grnLine = grn.lines.id(line.grnLine);
      if (!grnLine) throw Object.assign(new Error('GRN line not found'), { status: 404 });

      // Unit cost must match original GRN unit cost
      if (Number(line.unitCost) !== Number(grnLine.unitCost)) throw Object.assign(new Error('RETURN_PRICING_MISMATCH'), { status: 422 });

      // Already returned qty across confirmed returns
      const PurchaseReturnModel = require('../models/PurchaseReturn');
      const agg = await PurchaseReturnModel.aggregate([
        { $match: { company: companyId, 'lines.grnLine': new mongoose.Types.ObjectId(String(line.grnLine)), status: 'confirmed' } },
        { $unwind: '$lines' },
        { $match: { 'lines.grnLine': new mongoose.Types.ObjectId(String(line.grnLine)) } },
        { $group: { _id: null, returned: { $sum: '$lines.qtyReturned' } } }
      ]).session(sess);
      const alreadyReturned = (agg[0] && agg[0].returned) || 0;

      if (line.qtyReturned + alreadyReturned > grnLine.qtyReceived + 1e-9) {
        throw Object.assign(new Error('RETURN_EXCEEDS_RECEIVED'), { status: 422 });
      }

      // Check warehouse stock
      const product = await Product.findById(line.product).session(sess);
      if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
      if ((product.currentStock || 0) < line.qtyReturned - 1e-9) {
        throw Object.assign(new Error('INSUFFICIENT_STOCK'), { status: 409 });
      }

      // Reduce stock_levels qty_on_hand
      if (!modifiedProducts.has(String(product._id))) modifiedProducts.set(String(product._id), { prevStock: product.currentStock, prevAvg: product.averageCost });
      product.currentStock = (product.currentStock || 0) - line.qtyReturned;
      await product.save(opts);

      // FIFO: reduce matching lot's qty_remaining (find batch matching grn line by unitCost/product/warehouse)
      if (product.costingMethod === 'fifo') {
        const batch = await InventoryBatch.findOne({ company: companyId, product: line.product, warehouse: pr.warehouse, unitCost: line.unitCost, availableQuantity: { $gte: line.qtyReturned } }).sort({ receivedDate: -1 }).session(sess);
        if (batch) {
          modifiedBatches.push({ id: batch._id, prevAvailable: batch.availableQuantity });
          batch.availableQuantity = batch.availableQuantity - line.qtyReturned;
          await batch.save(opts);
        } else {
          // no matching batch with enough quantity - insufficient stock at lot level
          throw Object.assign(new Error('INSUFFICIENT_STOCK_LOT'), { status: 409 });
        }
      }

      // Create return_out stock movement
      const movement = new StockMovement({
        company: companyId,
        product: line.product,
        type: 'out',
        reason: 'return',
        quantity: line.qtyReturned,
        previousStock: modifiedProducts.get(String(product._id)).prevStock,
        newStock: product.currentStock,
        unitCost: line.unitCost,
        totalCost: line.unitCost * line.qtyReturned,
        warehouse: pr.warehouse,
        referenceType: 'return',
        referenceNumber: pr.referenceNo || pr.referenceNo || pr.referenceNo,
        referenceDocument: pr._id,
        referenceModel: 'CreditNote',
        performedBy: req.user.id,
        movementDate: new Date()
      });
      await movement.save(opts);
      createdMovements.push(movement._id);

      totalReturnNet += Number(line.unitCost) * line.qtyReturned;
      // Tax: find tax from original GRN/PO line if available
      const poLine = await PurchaseOrder.findOne({ 'lines._id': grnLine.purchaseOrderLine }).then(po => po ? po.lines.id(grnLine.purchaseOrderLine) : null);
      const taxRate = poLine ? (poLine.taxRate || 0) : 0;
      const lineTax = Number(line.unitCost) * line.qtyReturned * (taxRate/100);
      totalReturnTax += lineTax;
    }

    // Build journal lines: DR AP, CR VAT, CR Inventory per product
    const journalLines = [];
    // DR Accounts Payable - total incl tax
    const apAcct = await JournalService.getMappedAccountCode(companyId, 'purchases', 'accountsPayable', DEFAULT_ACCOUNTS.accountsPayable);
    journalLines.push(JournalService.createDebitLine(apAcct, totalReturnNet + totalReturnTax, `Purchase Return ${pr.referenceNo || pr.referenceNo} - GRN#${grn.referenceNo}`));

    if (totalReturnTax > 0) {
      const vatAcct = await JournalService.getMappedAccountCode(companyId, 'tax', 'vatPayable', DEFAULT_ACCOUNTS.vatPayable);
      journalLines.push(JournalService.createCreditLine(vatAcct, totalReturnTax, `VAT reversal ${pr.referenceNo || pr.referenceNo}`));
    }

    // CR inventory lines per product
    const productSums = new Map();
    for (const l of pr.lines) {
      const prev = productSums.get(String(l.product)) || 0;
      productSums.set(String(l.product), prev + (Number(l.unitCost) * l.qtyReturned));
    }
    for (const [prodId, amt] of productSums.entries()) {
      const product = await Product.findById(prodId).lean();
      const invAcct = product && product.inventoryAccount ? product.inventoryAccount : (await JournalService.getMappedAccountCode(companyId, 'purchases', 'inventory', DEFAULT_ACCOUNTS.inventory, { productId: prodId, warehouseId: pr.warehouse }));
      journalLines.push(JournalService.createCreditLine(invAcct || DEFAULT_ACCOUNTS.inventory, amt, `Inventory reversal ${pr.referenceNo || pr.referenceNo}`));
    }

    // Post journal
    const supplier = await (require('../models/Supplier')).findById(pr.supplier).lean();
    const narration = `Purchase Return - ${supplier ? supplier.name : ''} - GRN#${grn.referenceNo} - PRN#${pr.referenceNo}`;

    let je;
    try {
      je = await JournalService.createEntry(companyId, req.user.id, {
        date: new Date(),
        description: narration,
        sourceType: 'purchase_return',
        sourceId: pr._id,
        sourceReference: pr.referenceNo,
        lines: journalLines,
        isAutoGenerated: true,
        session: useSession ? sess : null
      });

      pr.journalEntry = je._id;
      pr.status = 'confirmed';
      pr.confirmedBy = req.user.id;
      pr.confirmedAt = new Date();
      await pr.save(opts);

      return pr;
    } catch (jeErr) {
      // If we're inside a real transaction the DB will rollback when the transaction fails.
      // If not (no session support), perform manual rollback of created resources.
      if (!useSession) {
        try {
          // remove created stock movements
          if (createdMovements.length) await StockMovement.deleteMany({ _id: { $in: createdMovements } });
          // restore modified batches
          for (const b of modifiedBatches) {
            try {
              await InventoryBatch.findByIdAndUpdate(b.id, { $set: { availableQuantity: b.prevAvailable } });
            } catch (e) { /* best-effort */ }
          }
          // restore modified products
          for (const [pid, vals] of modifiedProducts.entries()) {
            try {
              await Product.findByIdAndUpdate(pid, { $set: { currentStock: vals.prevStock, averageCost: vals.prevAvg } });
            } catch (e) { /* best-effort */ }
          }
        } catch (rbErr) {
          console.error('Rollback failed after journal error', rbErr);
        }
      }
      throw jeErr;
    }
  };

  try {
    const result = await transactionService.runInTransaction(async (trx) => await doConfirm(trx));
    res.json({ success: true, message: 'Purchase return confirmed', data: await PurchaseReturn.findById(result._id) });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
};

exports.listPurchaseReturns = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const q = { company: companyId };
    const { supplier_id, grn_id, status, date_from, date_to } = req.query;
    if (supplier_id) q.supplier = supplier_id;
    if (grn_id) q.grn = grn_id;
    if (status) q.status = status;
    if (date_from || date_to) q.returnDate = {};
    if (date_from) q.returnDate.$gte = new Date(date_from);
    if (date_to) q.returnDate.$lte = new Date(date_to);

    const { page, limit, skip } = parsePagination(req.query);
    const total = await PurchaseReturn.countDocuments(q);
    const list = await PurchaseReturn.find(q)
      .populate('grn', 'referenceNo')
      .populate('supplier', 'name code')
      .populate('warehouse', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      data: list,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (err) { next(err); }
};

exports.getPurchaseReturn = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const pr = await PurchaseReturn.findOne({ _id: req.params.id, company: companyId })
      .populate('grn', 'referenceNo')
      .populate('supplier', 'name code')
      .populate('warehouse', 'name code')
      .populate('lines.product', 'name sku')
      .populate('confirmedBy', 'name email')
      .populate('createdBy', 'name email');
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
    res.json({ success: true, data: pr });
  } catch (err) { next(err); }
};

// Get summary of purchase returns
exports.getPurchaseReturnSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    const match = { company: companyId };
    if (startDate || endDate) {
      match.returnDate = {};
      if (startDate) match.returnDate.$gte = new Date(startDate);
      if (endDate) match.returnDate.$lte = new Date(endDate);
    }
    
    const summary = await PurchaseReturn.aggregate([
      { $match: match },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$grandTotal' }
      }}
    ]);
    
    const result = {
      total: summary.reduce((s, g) => s + g.count, 0),
      byStatus: summary
    };
    
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
