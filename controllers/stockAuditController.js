const mongoose = require('mongoose');
const { StockAudit, StockAuditLine } = require('../models/StockAudit');
const Product = require('../models/Product');
const Warehouse = require('../models/Warehouse');
const InventoryBatch = require('../models/InventoryBatch');
const StockMovement = require('../models/StockMovement');
const JournalService = require('../services/journalService');
const { runInTransaction } = require('../services/transactionService');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');

// @desc    Create and open a new stock audit (status → counting)
// @route   POST /api/stock-audits
// @access  Private
exports.createStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { warehouse, auditDate, type, category, notes, products } = req.body;

    // Validate warehouse exists
    const warehouseDoc = await Warehouse.findOne({ _id: warehouse, company: companyId });
    if (!warehouseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }

    // Business Rule: One audit per warehouse at a time (counting status)
    const existingAudit = await StockAudit.findOne({
      company: companyId,
      warehouse: warehouse,
      status: 'counting'
    });
    if (existingAudit) {
      return res.status(409).json({
        success: false,
        code: 'AUDIT_IN_PROGRESS',
        message: 'An audit is already in progress for this warehouse',
        existingAuditId: existingAudit._id
      });
    }

    // Get products to audit - if not provided, get all products in warehouse
    let productsToAudit = [];
    if (products && products.length > 0) {
      productsToAudit = await Product.find({
        _id: { $in: products },
        company: companyId
      });
    } else {
      // Get all products that have stock in this warehouse
      const batches = await InventoryBatch.find({
        company: companyId,
        warehouse: warehouse,
        status: { $nin: ['exhausted'] },
        availableQuantity: { $gt: 0 }
      }).populate('product');
      
      // Get unique products
      const productIds = [...new Set(batches.map(b => b.product._id.toString()))];
      productsToAudit = await Product.find({ _id: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) }, company: companyId });
    }

    // Build audit lines with system quantities (snapshot)
    const auditLines = [];
    for (const product of productsToAudit) {
      // Get system quantity and unit cost
      let qtySystem = 0;
      let unitCost = 0;

      // Check inventory batches first
      const batches = await InventoryBatch.find({
        company: companyId,
        product: product._id,
        warehouse: warehouse,
        status: { $nin: ['exhausted'] }
      });

      if (batches.length > 0) {
        // Calculate total quantity
        qtySystem = batches.reduce((sum, b) => sum + (b.availableQuantity || 0), 0);
        // Calculate weighted average cost
        const totalValue = batches.reduce((sum, b) => sum + ((b.availableQuantity || 0) * parseFloat(b.unitCost || 0)), 0);
        unitCost = qtySystem > 0 ? (totalValue / qtySystem) : 0;
      } else {
        // Fall back to product currentStock
        qtySystem = product.currentStock && product.currentStock.toString ? Number(product.currentStock.toString()) : Number(product.currentStock || 0);
        unitCost = product.averageCost && product.averageCost.toString ? Number(product.averageCost.toString()) : Number(product.averageCost || 0);
      }

      auditLines.push({
        product: product._id,
        qtySystem: qtySystem.toString(),
        qtyCounted: null, // NULL initially - warehouse team fills this
        qtyVariance: '0',
        unitCost: unitCost.toFixed(6),
        varianceValue: '0',
        journalEntry: null,
        notes: null
      });
    }

    // Create audit
    const audit = await StockAudit.create({
      company: companyId,
      warehouse: warehouse,
      auditDate: auditDate || new Date(),
      status: 'counting', // Auto-open to counting
      type: type || 'full',
      category: category || null,
      notes: notes || null,
      items: auditLines,
      totalItems: auditLines.length,
      itemsCounted: 0,
      itemsWithVariance: 0,
      totalVarianceValue: '0',
      createdBy: req.user.id
    });

    await audit.populate([
      { path: 'warehouse', select: 'name code' },
      { path: 'items.product', select: 'name sku' },
      { path: 'createdBy', select: 'name' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Stock audit created and opened',
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all stock audits
// @route   GET /api/stock-audits
// @access  Private
exports.getStockAudits = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { warehouse, status, date_from, date_to, page = 1, limit = 20 } = req.query;

    const query = { company: companyId };

    if (warehouse) query.warehouse = warehouse;
    if (status) query.status = status;
    if (date_from || date_to) {
      query.auditDate = {};
      if (date_from) query.auditDate.$gte = new Date(date_from);
      if (date_to) query.auditDate.$lte = new Date(date_to);
    }

    const total = await StockAudit.countDocuments(query);
    const audits = await StockAudit.find(query)
      .populate('warehouse', 'name code')
      .populate('createdBy', 'name')
      .populate('postedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      success: true,
      count: audits.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: audits
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single stock audit
// @route   GET /api/stock-audits/:id
// @access  Private
exports.getStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    })
      .populate('warehouse', 'name code')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'name')
      .populate('postedBy', 'name')
      .populate('items.journalEntry');

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: 'Stock audit not found'
      });
    }

    res.json({
      success: true,
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk update qty_counted values on audit lines
// @route   PUT /api/stock-audits/:id/lines
// @access  Private
exports.bulkUpdateLines = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { lines } = req.body; // Array of { productId, qtyCounted }

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    });

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    if (audit.status !== 'counting') {
      return res.status(400).json({
        success: false,
        message: 'Can only update lines in counting status'
      });
    }

    // Update lines
    for (const update of lines) {
      const line = audit.items.find(
        item => item.product.toString() === update.productId
      );
      if (line) {
        line.qtyCounted = update.qtyCounted.toString();
        
        // Recalculate variance
        const qtySystem = parseFloat(line.qtySystem) || 0;
        const qtyCounted = parseFloat(update.qtyCounted) || 0;
        const variance = qtyCounted - qtySystem;
        line.qtyVariance = variance.toString();
        
        // Calculate variance value
        const unitCost = parseFloat(line.unitCost) || 0;
        line.varianceValue = (Math.abs(variance) * unitCost).toFixed(2);
      }
    }

    // Recalculate summary
    audit.calculateSummary();
    await audit.save();

    await audit.populate([
      { path: 'warehouse', select: 'name code' },
      { path: 'items.product', select: 'name sku' }
    ]);

    res.json({
      success: true,
      message: 'Audit lines updated',
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update single audit line qty_counted
// @route   PUT /api/stock-audits/:id/lines/:lineId
// @access  Private
exports.updateLine = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { qtyCounted, notes } = req.body;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    });

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    if (audit.status !== 'counting') {
      return res.status(400).json({
        success: false,
        message: 'Can only update lines in counting status'
      });
    }

    // Find the line
    const line = audit.items.id(req.params.lineId);
    if (!line) {
      return res.status(404).json({ success: false, message: 'Audit line not found' });
    }

    // Update
    if (qtyCounted !== undefined) {
      line.qtyCounted = qtyCounted.toString();
      
      // Recalculate variance
      const qtySystem = parseFloat(line.qtySystem) || 0;
      const qtyCountedNum = parseFloat(qtyCounted) || 0;
      const variance = qtyCountedNum - qtySystem;
      line.qtyVariance = variance.toString();
      
      // Calculate variance value
      const unitCost = parseFloat(line.unitCost) || 0;
      line.varianceValue = (Math.abs(variance) * unitCost).toFixed(2);
    }
    
    if (notes !== undefined) {
      line.notes = notes;
    }

    // Recalculate summary
    audit.calculateSummary();
    await audit.save();

    res.json({
      success: true,
      message: 'Audit line updated',
      data: line
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Post stock audit - executes all journal + stock logic
// @route   POST /api/stock-audits/:id/post
// @access  Private
exports.postStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    }).populate('items.product');

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    // Validation: Status must be counting
    if (audit.status !== 'counting') {
      return res.status(400).json({
        success: false,
        message: 'Audit must be in counting status to post'
      });
    }

    // Validation: All lines must have qty_counted
    const linesWithoutCount = audit.items.filter(item => !item.qtyCounted);
    if (linesWithoutCount.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'All audit lines must have qty_counted filled in',
        missingCount: linesWithoutCount.length
      });
    }

    // Get warehouse for inventory account
    const warehouse = await Warehouse.findById(audit.warehouse);
    const defaultInv = warehouse?.inventoryAccount || DEFAULT_ACCOUNTS.inventory;

    // Process all lines inside transaction
    await runInTransaction(async (trx) => {
      const journalBatch = [];
      const journalTargets = [];
      for (const line of audit.items) {
        const variance = parseFloat(line.qtyVariance) || 0;
        
        // Skip lines with zero variance
        if (variance === 0) {
          continue;
        }

        const varianceValue = parseFloat(line.varianceValue) || 0;
        const product = line.product;
        
        // Get product's inventory account code (resolve ObjectId to code if needed)
        const productDoc = await Product.findById(product._id).session(trx || undefined);
        let invAccountId = productDoc?.inventoryAccount || defaultInv;
        // If it's an ObjectId, look up the account code
        let invAccount = invAccountId;
        if (invAccountId && typeof invAccountId === 'object' || (typeof invAccountId === 'string' && invAccountId.length === 24 && /^[0-9a-fA-F]{24}$/.test(invAccountId))) {
          const ChartOfAccounts = require('../models/ChartOfAccount');
          const acctDoc = await ChartOfAccounts.findById(invAccountId).session(trx || undefined);
          invAccount = acctDoc ? acctDoc.code : DEFAULT_ACCOUNTS.inventory;
        }

        // Step 2: Create stock movement
        const movementReason = variance > 0 ? 'audit_surplus' : 'audit_shortage';
        const prevStock = Number(productDoc?.currentStock) || 0;
        const newStock = Number(prevStock) + Number(variance);

        await StockMovement.create([{
          company: companyId,
          product: product._id,
          type: variance > 0 ? 'in' : 'out',
          reason: movementReason,
          quantity: mongoose.Types.Decimal128.fromString(Math.abs(variance).toString()),
          previousStock: mongoose.Types.Decimal128.fromString(prevStock.toString()),
          newStock: mongoose.Types.Decimal128.fromString(newStock.toString()),
          unitCost: mongoose.Types.Decimal128.fromString((parseFloat(line.unitCost) || 0).toString()),
          totalCost: mongoose.Types.Decimal128.fromString(Math.abs(varianceValue).toString()),
          warehouse: audit.warehouse,
          referenceType: 'stock_audit',
          referenceNumber: audit.referenceNo,
          referenceDocument: audit._id,
          referenceModel: 'StockAudit',
          notes: `Stock Audit ${audit.referenceNo} - ${variance > 0 ? 'Surplus' : 'Shortage'}: ${variance} units`,
          performedBy: req.user.id,
          movementDate: new Date()
        }], trx ? { session: trx } : undefined);

        // Step 3: Update product stock
        if (productDoc) {
          productDoc.currentStock = Math.max(0, newStock);
          await productDoc.save(trx ? { session: trx } : undefined);
        }

        // Step 4: Handle FIFO lots
        if (productDoc?.trackBatch) {
          if (variance > 0) {
            // Positive variance: create new lot
            await InventoryBatch.create([{
              company: companyId,
              product: product._id,
              warehouse: audit.warehouse,
              batchNumber: `AUD-${audit.referenceNo}`,
              quantity: variance,
              availableQuantity: variance,
              unitCost: parseFloat(line.unitCost) || 0,
              totalCost: varianceValue,
              status: 'active',
              receivedAt: new Date(),
              createdBy: req.user.id
            }], trx ? { session: trx } : undefined);
          } else {
            // Negative variance: consume lots FIFO
            const lots = await InventoryBatch.find({
              company: companyId,
              product: product._id,
              warehouse: audit.warehouse,
              status: { $nin: ['exhausted'] },
              availableQuantity: { $gt: 0 }
            }).sort({ receivedAt: 1 }).session(trx || undefined);

            let remainingQty = Math.abs(variance);
            for (const lot of lots) {
              if (remainingQty <= 0) break;
              const deductQty = Math.min(lot.availableQuantity, remainingQty);
              lot.availableQuantity -= deductQty;
              lot.updateStatus();
              await lot.save(trx ? { session: trx } : undefined);
              remainingQty -= deductQty;
            }
          }
        }

        // Step 5: Prepare journal entry options per line (batch post later)
        const narration = `Stock Audit - ${product.name} - AUD#${audit.referenceNo} - Variance: ${variance > 0 ? '+' : ''}${variance} units`;
        // Only prepare entries for non-zero variance (we're already in that branch)
        const entryOptions = {
          date: audit.auditDate || new Date(),
          description: narration,
          sourceType: 'stock_audit',
          sourceId: audit._id,
          sourceReference: audit.referenceNo,
          lines: [],
          isAutoGenerated: true
        };

        if (variance > 0) {
          // Surplus: DR inventory, CR stockAdjustment
          entryOptions.lines.push(JournalService.createDebitLine(invAccount, varianceValue, `Inventory - ${product.name}`));
          entryOptions.lines.push(JournalService.createCreditLine(DEFAULT_ACCOUNTS.stockAdjustment, varianceValue, narration));
        } else {
          // Shortage: DR stockAdjustment, CR inventory
          entryOptions.lines.push(JournalService.createDebitLine(DEFAULT_ACCOUNTS.stockAdjustment, varianceValue, narration));
          entryOptions.lines.push(JournalService.createCreditLine(invAccount, varianceValue, `Inventory - ${product.name}`));
        }

        // Collect entries to post atomically after processing lines
        journalBatch.push(entryOptions);
        journalTargets.push(line);
      }

      // After processing lines, post collected journal entries atomically if any
      if (journalBatch && journalBatch.length > 0) {
        if (JournalService.createEntriesAtomic) {
          const created = await JournalService.createEntriesAtomic(companyId, req.user.id, journalBatch, { session: trx || null });
          // assign created JE ids back to lines in same order
          for (let i = 0; i < created.length; i++) {
            const targetLine = journalTargets[i];
            if (created[i] && (created[i]._id || created[i].id)) targetLine.journalEntry = created[i]._id || created[i].id;
          }
        } else {
          // fallback: create entries individually using createEntry
          for (let i = 0; i < journalBatch.length; i++) {
            try {
              const je = await JournalService.createEntry(companyId, req.user.id, journalBatch[i], trx ? { session: trx } : undefined);
              const targetLine = journalTargets[i];
              if (je && (je._id || je.id)) targetLine.journalEntry = je._id || je.id;
            } catch (e) {
              throw e;
            }
          }
        }
      }

      // Update audit totals and status
      audit.calculateSummary();
      audit.status = 'posted';
      audit.postedBy = req.user.id;
      audit.postedAt = new Date();
      audit.journalEntry = null; // No aggregated JE - each line has its own

      await audit.save(trx ? { session: trx } : undefined);
    });

    await audit.populate([
      { path: 'warehouse', select: 'name code' },
      { path: 'items.product', select: 'name sku' },
      { path: 'postedBy', select: 'name' }
    ]);

    res.json({
      success: true,
      message: 'Stock audit posted successfully',
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel stock audit
// @route   POST /api/stock-audits/:id/cancel
// @access  Private
exports.cancelStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { reason } = req.body;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    });

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    // Business Rule: Can only cancel counting audits
    if (audit.status !== 'counting') {
      return res.status(400).json({
        success: false,
        message: 'Can only cancel audits in counting status'
      });
    }

    audit.status = 'cancelled';
    audit.notes = `${audit.notes || ''}\nCancellation reason: ${reason || 'Not specified'}`;
    await audit.save();

    await audit.populate([
      { path: 'warehouse', select: 'name code' },
      { path: 'items.product', select: 'name sku' }
    ]);

    res.json({
      success: true,
      message: 'Stock audit cancelled',
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update stock audit
// @route   PUT /api/stock-audits/:id
// @access  Private
exports.updateStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { notes, type } = req.body;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    });

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    // Can only update draft or counting audits
    if (!['draft', 'counting'].includes(audit.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only update audits in draft or counting status'
      });
    }

    if (notes !== undefined) audit.notes = notes;
    if (type !== undefined) audit.type = type;

    await audit.save();

    await audit.populate([
      { path: 'warehouse', select: 'name code' },
      { path: 'items.product', select: 'name sku' }
    ]);

    res.json({
      success: true,
      message: 'Stock audit updated',
      data: audit
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete stock audit
// @route   DELETE /api/stock-audits/:id
// @access  Private
exports.deleteStockAudit = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const audit = await StockAudit.findOne({
      _id: req.params.id,
      company: companyId
    });

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Stock audit not found' });
    }

    // Can only delete draft audits
    if (audit.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete audits in draft status'
      });
    }

    await audit.deleteOne();

    res.json({
      success: true,
      message: 'Stock audit deleted'
    });
  } catch (error) {
    next(error);
  }
};
