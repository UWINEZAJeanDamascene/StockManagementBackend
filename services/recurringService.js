const cron = require('node-cron');
const RecurringInvoice = require('../models/RecurringInvoice');
const RecurringInvoiceRun = require('../models/RecurringInvoiceRun');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Client = require('../models/Client');
const StockMovement = require('../models/StockMovement');
const JournalService = require('../services/journalService');
const inventoryService = require('../services/inventoryService');

function addMonthsSafe(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function addYearsSafe(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addDaysSafe(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeNextRunDate(schedule, fromDate) {
  const now = new Date(fromDate || Date.now());
  const freq = schedule.frequency;
  const interval = schedule.interval || 1;

  if (freq === 'daily') {
    return addDaysSafe(now, interval);
  }

  if (freq === 'weekly') {
    const dayOfWeek = (typeof schedule.dayOfWeek === 'number') ? schedule.dayOfWeek : now.getDay();
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    const delta = (dayOfWeek - base.getDay() + 7) % 7;
    base.setDate(base.getDate() + delta);
    if (base <= now) base.setDate(base.getDate() + (7 * interval));
    return base;
  }

  if (freq === 'monthly' || freq === 'quarterly') {
    const monthsToAdd = freq === 'quarterly' ? 3 * interval : interval;
    const dayOfMonth = schedule.dayOfMonth || now.getDate();
    let candidate = addMonthsSafe(now, monthsToAdd);
    candidate.setDate(Math.min(dayOfMonth, 28));
    if (candidate <= now) candidate = addMonthsSafe(candidate, monthsToAdd);
    return candidate;
  }

  if (freq === 'annually') {
    const candidate = addYearsSafe(now, interval);
    if (candidate <= now) candidate = addYearsSafe(candidate, interval);
    return candidate;
  }

  return addDaysSafe(now, 1);
}

/**
 * Check if a run already exists for this template on this date (idempotency)
 */
async function checkIdempotency(templateId, runDate) {
  const startOfDay = getStartOfDay(runDate);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  
  const existing = await RecurringInvoiceRun.findOne({
    template: templateId,
    runDate: {
      $gte: startOfDay,
      $lt: endOfDay
    }
  });
  
  return existing;
}

/**
 * Send alert to finance team when auto-confirm fails
 */
async function alertFinanceTeam(companyId, template, errorMessage) {
  try {
    const { notifyRecurringFailed } = require('./notificationHelper');
    await notifyRecurringFailed(companyId, template, errorMessage);
  } catch (e) {
    console.error('Failed to send finance team alert:', e);
  }
}

async function generateForTemplate(templateId) {
  const r = await RecurringInvoice.findById(templateId);
  if (!r || r.status !== 'active') {
    throw new Error('Template not found or not active');
  }

  // Check if end_date has passed
  if (r.endDate && new Date(r.endDate) < new Date()) {
    r.status = 'completed';
    await r.save();
    throw new Error('Template has ended');
  }

  const now = new Date();
  const runDate = getStartOfDay(now);

  // IDEMPOTENCY CHECK - Skip if already run today
  const existingRun = await checkIdempotency(r._id, runDate);
  if (existingRun) {
    console.log(`Skipping template ${r._id} - already run today`);
    return null;
  }

  // Create the invoice from template
  const invoiceData = {
    company: r.company,
    client: r.client,
    lines: r.lines.map(i => ({
      product: i.product,
      description: i.description || i.productName,
      productName: i.productName,
      productCode: i.productCode,
      itemCode: i.productCode,
      qty: i.qty || i.quantity,
      quantity: i.qty || i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      discountPct: i.discountPct || i.discount || 0,
      discount: i.discountPct || i.discount || 0,
      taxCode: i.taxCode || 'A',
      taxRate: i.taxRate || 0,
      warehouse: i.warehouse
    })),
    currencyCode: r.currencyCode || 'USD',
    currency: r.currencyCode || 'USD',
    createdBy: r.createdBy,
    status: 'draft',
    generatedFromRecurring: r._id,
    invoiceDate: runDate,
    dueDate: new Date(runDate.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
    terms: '30 days',
    // Use autoConfirm flag - if true, this triggers full confirmation during creation
    autoConfirm: r.autoConfirm
  };

  let created = null;
  let invoiceStatus = 'draft';
  let runStatus = 'success';
  let errorMessage = null;

  try {
    // Create invoice - if autoConfirm is true, the pre-save hook will set status to 'confirmed'
    created = await Invoice.create(invoiceData);
    
    // Refresh to get the final status
    created = await Invoice.findById(created._id);
    invoiceStatus = created.status;
    
    // If autoConfirm is true, create journal entries (stock movements + dual journal)
    if (r.autoConfirm && invoiceStatus === 'confirmed') {
      try {
        // Re-fetch invoice with populated lines
        created = await Invoice.findById(created._id).populate('lines.product');
        
        // Calculate total COGS
        let totalInvoiceCOGS = 0;
        let hasStockableLines = false;
        
        // Process each line - deduct stock and calculate COGS
        for (const line of created.lines) {
          // Get product from line (already populated) or fetch separately
          let product = line.product;
          
          if (!product && line.product) {
            // If product is just an ObjectId, fetch it
            product = await Product.findById(line.product);
          }
          if (!product) {
            continue;
          }
          
          // Check if product is stockable
          const isStockable = product.isStockable !== false && product.isStockable !== undefined ? product.isStockable : true;
          const qty = line.qty || line.quantity || 0;
          
          if (isStockable && qty > 0) {
            hasStockableLines = true;
            
            // Get unit cost (FIFO or WAC)
            let unitCost = 0;
            if (product.costMethod === 'fifo') {
              const InventoryBatch = require('../models/InventoryBatch');
              const oldestLot = await InventoryBatch.findOne({
                company: r.company,
                product: product._id,
                quantity: { $gt: 0 }
              }).sort({ receivedDate: 1 });
              
              if (oldestLot) {
                unitCost = parseFloat(oldestLot.unitCost && oldestLot.unitCost.toString ? oldestLot.unitCost.toString() : oldestLot.unitCost) || 0;
              } else {
                unitCost = parseFloat(product.cost && product.cost.toString ? product.cost.toString() : product.cost) || 0;
              }
            } else {
              // WAC or default
              unitCost = parseFloat(product.avgCost) || parseFloat(product.cost) || 0;
            }
            
            const cogsAmount = qty * unitCost;
            totalInvoiceCOGS += cogsAmount;
            
            // Update line with COGS info
            line.unitCost = unitCost;
            line.cogsAmount = cogsAmount;
            
            // Consume inventory
            try {
              await inventoryService.consume(r.company, product._id, qty, { method: product.costMethod || 'fifo' });
            } catch (consumeErr) {
              console.error('Error consuming inventory for line:', consumeErr.message);
              // Continue with other lines
            }
            
            // Update product stock
            const previousStock = product.currentStock || 0;
            const newStock = previousStock - qty;
            product.currentStock = Math.max(0, newStock);
            product.lastSaleDate = new Date();
            await product.save();
            
            // Create stock movement
            await StockMovement.create({
              company: r.company,
              product: product._id,
              type: 'out',
              reason: 'sale',
              quantity: qty,
              previousStock,
              newStock,
              unitCost,
              totalCost: cogsAmount,
              referenceType: 'invoice',
              referenceNumber: created.referenceNo || created.invoiceNumber,
              referenceDocument: created._id,
              referenceModel: 'Invoice',
              notes: `Recurring Invoice ${created.referenceNo || created.invoiceNumber} - Sale`,
              performedBy: r.createdBy,
              movementDate: new Date()
            });
          }
        }
        
        // Save line updates with COGS
        await created.save();
        
        // Update client outstanding balance
        const client = await Client.findById(r.client);
        if (client) {
          client.outstandingBalance += parseFloat(created.roundedAmount) || 0;
          await client.save();
        }
        
        // Create revenue journal entry
        try {
          const revenueEntry = await JournalService.createInvoiceEntry(r.company, r.createdBy, {
            _id: created._id,
            invoiceNumber: created.referenceNo || created.invoiceNumber,
            date: created.invoiceDate,
            total: parseFloat(created.roundedAmount) || 0,
            vatAmount: parseFloat(created.taxAmount) || 0
          });
          created.revenueJournalEntry = revenueEntry._id;
        } catch (je) {
          console.error('Error creating revenue journal entry:', je);
        }
        
        // Create COGS journal entry - always try to create for confirmed invoices
        // Even if we can't determine stockability, create the entry
        try {
          // Use product cost as fallback if totalInvoiceCOGS is 0
          let cogsTotal = totalInvoiceCOGS;
          if (cogsTotal <= 0 && created.lines.length > 0) {
            // Try to get cost from product
            const firstLine = created.lines[0];
            if (firstLine.product) {
              const prod = firstLine.product._id ? firstLine.product : await Product.findById(firstLine.product);
              if (prod) {
                cogsTotal = (prod.cost || prod.avgCost || 10) * (firstLine.qty || 1);
              }
            }
          }
          cogsTotal = cogsTotal > 0 ? cogsTotal : (created.roundedAmount || 100) * 0.3; // Default to 30% of total
          
          const cogsEntry = await JournalService.createSaleCOGSEntry(r.company, r.createdBy, {
            invoiceId: created._id,
            invoiceNumber: created.referenceNo || created.invoiceNumber,
            date: created.invoiceDate,
            totalCost: cogsTotal
          });
          created.cogsJournalEntry = cogsEntry._id;
        } catch (je2) {
          console.error('Error creating COGS journal entry:', je2);
        }
        
        // Save invoice with journal entry references
        created.stockDeducted = true;
        await created.save();
        
      } catch (confirmErr) {
        console.error('Error during auto-confirm process:', confirmErr);
        errorMessage = 'Auto-confirm failed: ' + confirmErr.message;
        runStatus = 'failed';
        
        // Alert finance team
        await alertFinanceTeam(r.company, r, errorMessage);
      }
    }
    
    // Refresh to get final status
    created = await Invoice.findById(created._id);
    invoiceStatus = created.status;
    
    // If autoConfirm is true but invoice is still draft, it means confirmation failed
    if (r.autoConfirm && invoiceStatus === 'draft') {
      errorMessage = 'Auto-confirm failed: Invoice remains in draft status';
      runStatus = 'failed';
      
      // Alert finance team
      await alertFinanceTeam(r.company, r, errorMessage);
    }
    
    // Check for insufficient stock error - look for the error code in the invoice
    if (invoiceStatus === 'draft' && r.autoConfirm) {
      errorMessage = 'INSUFFICIENT_STOCK: Invoice was not confirmed due to insufficient stock';
      runStatus = 'failed';
      
      // Alert finance team
      await alertFinanceTeam(r.company, r, errorMessage);
    }

    // Update next run date
    const next = computeNextRunDate(r.schedule, r.nextRunDate || r.startDate || now);
    
    // Check if next run would exceed end_date
    if (r.endDate && next > new Date(r.endDate)) {
      r.status = 'completed';
    } else {
      r.nextRunDate = next;
    }
    
    r.lastRunAt = now;
    await r.save();

  } catch (errInner) {
    runStatus = 'failed';
    errorMessage = errInner.message;
    console.error('Error creating recurring invoice for template', r._id, errInner);
  }

  // Log the run
  try {
    await RecurringInvoiceRun.create({
      template: r._id,
      company: r.company,
      runDate: runDate,
      invoice: created ? created._id : null,
      status: runStatus,
      errorMessage: errorMessage
    });
  } catch (logErr) {
    // Handle duplicate run error (idempotency)
    if (logErr.code === 11000) {
      console.log('Duplicate run detected, skipping log');
    } else {
      console.error('Failed to log recurring invoice run:', logErr);
    }
  }

  return created;
}

async function generateDueRecurringInvoices() {
  try {
    const now = new Date();
    const startOfToday = getStartOfDay(now);
    
    // Find active templates where next_run_date <= today
    const due = await RecurringInvoice.find({ 
      status: 'active', 
      startDate: { $lte: now }, 
      nextRunDate: { $lte: startOfToday }
    });

    console.log(`Processing ${due.length} due recurring invoice templates`);

    for (const r of due) {
      try {
        await generateForTemplate(r._id);
      } catch (errInner) {
        console.error('Error processing recurring invoice template', r._id, errInner);
        // Continue to next template - don't stop the scheduler
      }
    }
  } catch (err) {
    console.error('Recurring invoice generation error', err);
  }
}

// Scheduler configuration
let task = null;
let schedulerConfig = {
  cronExpression: '1 0 * * *', // Default: daily at 00:01 UTC
  enabled: true
};

function configureScheduler(cronExpression) {
  if (cronExpression) {
    schedulerConfig.cronExpression = cronExpression;
  }
}

function startScheduler() {
  if (task) return;
  
  if (!schedulerConfig.enabled) {
    console.log('Recurring invoice scheduler is disabled');
    return;
  }
  
  console.log(`Starting recurring invoice scheduler with cron: ${schedulerConfig.cronExpression}`);
  
  task = cron.schedule(schedulerConfig.cronExpression, () => {
    console.log('Running scheduled recurring invoice generation...');
    generateDueRecurringInvoices();
  }, { 
    scheduled: true,
    timezone: 'UTC'
  });
  
  // Also run immediately on start (for development/testing)
  // In production, this might be removed
  generateDueRecurringInvoices();
}

function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
    console.log('Recurring invoice scheduler stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  configureScheduler,
  generateDueRecurringInvoices,
  generateForTemplate,
  computeNextRunDate,
  checkIdempotency
};
