const mongoose = require('mongoose');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const PurchaseOrder = require('../models/PurchaseOrder');
const InventoryBatch = require('../models/InventoryBatch');
const StockBatch = require('../models/StockBatch');
const StockSerialNumber = require('../models/StockSerialNumber');
const StockMovement = require('../models/StockMovement');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const JournalService = require('../services/journalService');
const transactionService = require('../services/transactionService');
const cacheService = require('../services/cacheService');
const DEFAULT_ACCOUNTS = require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS;

// Create GRN (simple create against approved PO)
exports.createGRN = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { purchaseOrderId, warehouse, lines, referenceNo } = req.body;

    const po = await PurchaseOrder.findOne({ _id: purchaseOrderId, company: companyId });
    if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (po.status !== 'approved') return res.status(409).json({ success: false, message: 'PO must be approved before creating GRN' });

    const grn = await GoodsReceivedNote.create({
      company: companyId,
      referenceNo,
      purchaseOrder: po._id,
      warehouse,
      supplier: po.supplier,
      lines,
      createdBy: req.user.id
    });

    res.status(201).json({ success: true, data: grn });
  } catch (err) {
    next(err);
  }
};

// Confirm GRN: transactional stock updates + journal posting
exports.confirmGRN = async (req, res, next) => {
  const companyId = req.user.company._id;

  const runConfirm = async (sess) => {
    // sess may be null
    const useSession = !!sess;
    const findOpts = useSession ? { session: sess } : {};

    const grn = await GoodsReceivedNote.findOne({ _id: req.params.id, company: companyId }, null, findOpts);
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });
    if (grn.status === 'confirmed') throw Object.assign(new Error('GRN already confirmed'), { status: 400 });

    const po = await PurchaseOrder.findOne({ _id: grn.purchaseOrder, company: companyId }, null, findOpts);
    if (!po) throw Object.assign(new Error('Purchase order not found'), { status: 404 });
    if (po.status !== 'approved') throw Object.assign(new Error('PO must be approved to confirm GRN'), { status: 409 });

    let journalLines = [];
    let vatTotal = 0;
    let apTotal = 0;
    const productTotals = new Map();

    // Track created resources for manual rollback when not using DB transactions
    const createdBatches = [];
    const createdStockBatches = [];
    const createdSerialNumbers = [];
    const createdMovements = [];
    const updatedProducts = new Map(); // productId -> { previousStock, previousAvg }
    const updatedPOLines = [];

    // First pass: Validate tracking types and prepare batch/serial data
    for (const line of grn.lines) {
      const product = await Product.findOne({ _id: line.product, company: companyId }, null, useSession ? { session: sess } : {});
      
      if (!product) {
        throw Object.assign(new Error(`Product not found: ${line.product}`), { status: 404 });
      }

      // Ensure stockable products have a valid unit cost
      const isStockable = product.isStockable !== false && product.isStockable !== undefined ? product.isStockable : true;
      if (isStockable && (!line.unitCost || Number(line.unitCost) <= 0)) {
        throw Object.assign(new Error(`Unit cost must be greater than zero for stockable product ${product.name}`), { status: 400 });
      }

      const trackingType = product.trackingType || 'none';

      // Batch tracking: require batchNo
      if (trackingType === 'batch') {
        if (!line.batchNo) {
          throw Object.assign(new Error(`Batch number required for product ${product.name} (tracking_type=batch)`), { status: 400 });
        }
      }

      // Serial tracking: require serialNumbers array with count matching qtyReceived
      if (trackingType === 'serial') {
        if (!line.serialNumbers || !Array.isArray(line.serialNumbers)) {
          throw Object.assign(new Error(`Serial numbers array required for product ${product.name} (tracking_type=serial)`), { status: 400 });
        }
        if (line.serialNumbers.length !== line.qtyReceived) {
          throw Object.assign(new Error(`Serial numbers count (${line.serialNumbers.length}) must equal qty_received (${line.qtyReceived}) for product ${product.name}`), { status: 400 });
        }
      }
    }

    // Second pass: Process stock
    for (const line of grn.lines) {
      const product = await Product.findOne({ _id: line.product, company: companyId }, null, useSession ? { session: sess } : {});
      const trackingType = product.trackingType || 'none';

      // Handle batch tracking
      if (trackingType === 'batch' && line.batchNo) {
        // Check if batch already exists
        let stockBatch = await StockBatch.findOne({
          company: companyId,
          product: line.product,
          warehouse: grn.warehouse,
          batchNo: line.batchNo.toUpperCase()
        }, null, useSession ? { session: sess } : {});

        if (stockBatch) {
          // Update existing batch
          stockBatch.qtyOnHand = (Number(stockBatch.qtyOnHand) || 0) + Number(line.qtyReceived);
          await stockBatch.save(useSession ? { session: sess } : {});
        } else {
          // Create new batch
          stockBatch = new StockBatch({
            company: companyId,
            product: line.product,
            warehouse: grn.warehouse,
            grn: grn._id,
            batchNo: line.batchNo.toUpperCase(),
            qtyReceived: line.qtyReceived,
            qtyOnHand: line.qtyReceived,
            unitCost: line.unitCost,
            manufactureDate: line.manufactureDate || null,
            expiryDate: line.expiryDate || null,
            isQuarantined: false
          });
          await stockBatch.save(useSession ? { session: sess } : {});
          createdStockBatches.push(stockBatch._id);
        }
      }

      // Handle serial number tracking
      if (trackingType === 'serial' && line.serialNumbers && line.serialNumbers.length > 0) {
        for (const serialNo of line.serialNumbers) {
          // Check if serial already exists for this product
          const existingSerial = await StockSerialNumber.findOne({
            company: companyId,
            product: line.product,
            serialNo: serialNo.toUpperCase()
          }, null, useSession ? { session: sess } : {});

          if (existingSerial) {
            throw Object.assign(new Error(`Serial number ${serialNo} already exists for product ${product.name}`), { status: 400 });
          }

          const stockSerial = new StockSerialNumber({
            company: companyId,
            product: line.product,
            warehouse: grn.warehouse,
            grn: grn._id,
            serialNo: serialNo.toUpperCase(),
            unitCost: line.unitCost,
            status: 'in_stock'
          });
          await stockSerial.save(useSession ? { session: sess } : {});
          createdSerialNumbers.push(stockSerial._id);
        }
      }

      // Continue with existing InventoryBatch creation (for backward compatibility)
      const batch = new InventoryBatch({
        company: companyId,
        product: line.product,
        warehouse: grn.warehouse,
        quantity: line.qtyReceived,
        availableQuantity: line.qtyReceived,
        unitCost: line.unitCost,
        receivedDate: grn.receivedDate,
        createdBy: req.user.id
      });
      await batch.save(useSession ? { session: sess } : {});
      createdBatches.push(batch._id);

      // Product already fetched above, reuse it
      const previousStock = Number(product.currentStock || 0);
      const previousAvg = Number(product.averageCost || 0);
      if (!updatedProducts.has(String(product._id))) {
        updatedProducts.set(String(product._id), { previousStock, previousAvg });
      }
      product.currentStock = (Number(product.currentStock || 0) + Number(line.qtyReceived));

      if (product.costingMethod === 'weighted') {
        const existingValue = (Number(product.averageCost) || 0) * previousStock;
        const receivedValue = Number(line.unitCost) * Number(line.qtyReceived);
        const newQty = previousStock + Number(line.qtyReceived);
        product.averageCost = newQty > 0 ? ((existingValue + receivedValue) / newQty) : product.averageCost;
      }

      await product.save(useSession ? { session: sess } : {});

      const movement = new StockMovement({
        company: companyId,
        product: line.product,
        type: 'in',
        reason: 'purchase',
        quantity: line.qtyReceived,
        previousStock,
        newStock: product.currentStock,
        unitCost: line.unitCost,
        totalCost: line.unitCost * line.qtyReceived,
        warehouse: grn.warehouse,
        referenceType: 'purchase_order',
        referenceNumber: po.referenceNo,
        referenceDocument: po._id,
        referenceModel: 'PurchaseOrder',
        performedBy: req.user.id,
        movementDate: new Date()
      });
      await movement.save(useSession ? { session: sess } : {});
      createdMovements.push(movement._id);

      const poLine = po.lines.id(line.purchaseOrderLine);
      if (poLine) {
        updatedPOLines.push({ id: String(poLine._id), previousQty: poLine.qtyReceived || 0 });
        poLine.qtyReceived = (poLine.qtyReceived || 0) + line.qtyReceived;
      }

      const lineNet = Number(line.unitCost) * line.qtyReceived;
      const lineTax = (poLine && poLine.taxRate) ? (lineNet * (poLine.taxRate / 100)) : 0;
      vatTotal += lineTax;
      apTotal += (lineNet + lineTax);

      const prev = productTotals.get(String(line.product)) || 0;
      productTotals.set(String(line.product), prev + lineNet);
    }

    const totalOrdered = po.lines.reduce((s, l) => s + (l.qtyOrdered || 0), 0);
    const totalReceived = po.lines.reduce((s, l) => s + (l.qtyReceived || 0), 0);
    po.status = totalReceived >= totalOrdered ? 'fully_received' : 'partially_received';
    await po.save(useSession ? { session: sess } : {});

    for (const [prodId, amt] of productTotals.entries()) {
      const product = await Product.findById(prodId).lean();
      const invAcct = product.inventoryAccount || (await JournalService.getMappedAccountCode(companyId, 'purchases', 'inventory', DEFAULT_ACCOUNTS.inventory, { productId: prodId, warehouseId: grn.warehouse }));
      journalLines.push(JournalService.createDebitLine(invAcct || DEFAULT_ACCOUNTS.inventory, amt, `Purchase ${po.referenceNo} - ${grn.referenceNo}`));
    }

    if (vatTotal > 0) {
      const vatAcct = await JournalService.getMappedAccountCode(companyId, 'tax', 'vatPayable', DEFAULT_ACCOUNTS.vatPayable);
      journalLines.push(JournalService.createDebitLine(vatAcct, vatTotal, `VAT for ${grn.referenceNo}`));
    }

    const apAcct = await JournalService.getMappedAccountCode(companyId, 'purchases', 'accountsPayable', DEFAULT_ACCOUNTS.accountsPayable);
    journalLines.push(JournalService.createCreditLine(apAcct, apTotal, `AP for ${po.referenceNo} / ${grn.referenceNo}`));

    const supplier = await Supplier.findById(po.supplier).lean();
    const narration = `Purchase - ${supplier ? supplier.name : ''} - PO#${po.referenceNo} - GRN#${grn.referenceNo}`;

    let je;
    try {
      const created = await JournalService.createEntriesAtomic(companyId, req.user.id, [{
        date: new Date(),
        description: narration,
        sourceType: 'purchase_order',
        sourceId: po._id,
        sourceReference: po.referenceNo,
        lines: journalLines,
        isAutoGenerated: true,
        session: useSession ? sess : null
      }], { session: useSession ? sess : null });
      je = (created && created.length) ? created[0] : null;
    } catch (jeErr) {
      // If we're not in a DB transaction, perform manual rollback of created resources
      if (!useSession) {
        try {
          // delete created movements
          if (createdMovements.length) {
            await StockMovement.deleteMany({ _id: { $in: createdMovements } });
          }
          // delete created batches
          if (createdBatches.length) {
            await InventoryBatch.deleteMany({ _id: { $in: createdBatches } });
          }
          // delete created stock batches (Module 4)
          if (createdStockBatches.length) {
            await StockBatch.deleteMany({ _id: { $in: createdStockBatches } });
          }
          // delete created serial numbers (Module 4)
          if (createdSerialNumbers.length) {
            await StockSerialNumber.deleteMany({ _id: { $in: createdSerialNumbers } });
          }
          // restore product stocks and avg
          for (const [prodId, prev] of updatedProducts.entries()) {
            await Product.updateOne({ _id: prodId }, { currentStock: prev.previousStock, averageCost: prev.previousAvg });
          }
          // restore PO lines
          for (const pl of updatedPOLines) {
            const lineDoc = po.lines.id(pl.id);
            if (lineDoc) lineDoc.qtyReceived = pl.previousQty;
          }
          // restore PO status
          po.status = 'approved';
          await po.save();

          // leave GRN as draft (do not set journalEntry)
        } catch (rbErr) {
          console.error('Failed during manual rollback after JE error:', rbErr);
        }
      }
      // rethrow to caller
      throw jeErr;
    }

    grn.journalEntry = je._id;
    grn.status = 'confirmed';
    grn.confirmedBy = req.user.id;
    grn.confirmedAt = new Date();
    await grn.save(useSession ? { session: sess } : {});

    return grn;
  };

  try {
    const result = await transactionService.runInTransaction(async (trx) => await runConfirm(trx));
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache bump after GRN confirm failed:', e);
    }
    res.json({ success: true, message: 'GRN confirmed', data: await GoodsReceivedNote.findById(result._id) });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
};
