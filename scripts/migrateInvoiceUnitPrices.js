/**
 * Migration: Fix invoice unit prices from delivery notes
 * 
 * Issue: Invoices were created using product.sellingPrice instead of
 * the sales order line unitPrice. This migration updates existing
 * invoices to use the correct unit prices from their source delivery notes.
 */

const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const DeliveryNote = require('../models/DeliveryNote');
const SalesOrder = require('../models/SalesOrder');

// Load environment variables
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_management';

async function migrateInvoiceUnitPrices() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to database');

    // Find all invoices linked to delivery notes
    const invoices = await Invoice.find({
      deliveryNote: { $exists: true, $ne: null }
    }).populate('deliveryNote');

    console.log(`Found ${invoices.length} invoices linked to delivery notes`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const invoice of invoices) {
      try {
        console.log(`\nProcessing invoice: ${invoice.referenceNo} (${invoice._id})`);

        // Skip if no delivery note
        if (!invoice.deliveryNote) {
          console.log('  - Skipped: No delivery note linked');
          skippedCount++;
          continue;
        }

        // Get the delivery note with lines populated
        const deliveryNote = await DeliveryNote.findById(invoice.deliveryNote._id)
          .populate('salesOrder');

        if (!deliveryNote) {
          console.log('  - Skipped: Delivery note not found');
          skippedCount++;
          continue;
        }

        // Get lines from delivery note
        const dnLines = deliveryNote.lines && deliveryNote.lines.length > 0
          ? deliveryNote.lines
          : deliveryNote.items || [];

        if (dnLines.length === 0) {
          console.log('  - Skipped: No lines in delivery note');
          skippedCount++;
          continue;
        }

        // Fetch sales order to get correct unit prices (fallback)
        let soLines = [];
        if (deliveryNote.salesOrder) {
          const salesOrder = await SalesOrder.findById(deliveryNote.salesOrder._id);
          soLines = salesOrder?.lines || [];
        }

        let hasChanges = false;
        const updatedLines = invoice.lines.map((invLine, idx) => {
          const dnLine = dnLines[idx];
          if (!dnLine) return invLine;

          // Priority: deliveryNote.line.unitPrice > salesOrder.line.unitPrice > current invoice price
          let correctUnitPrice = dnLine.unitPrice;

          // If delivery note doesn't have unitPrice, try to get from sales order
          if (!correctUnitPrice && dnLine.salesOrderLineId && soLines.length > 0) {
            const soLine = soLines.find(l => l.lineId === dnLine.salesOrderLineId);
            correctUnitPrice = soLine?.unitPrice;
          }

          // If still no unitPrice, skip this line
          if (!correctUnitPrice || correctUnitPrice === 0) {
            console.log(`  - Line ${idx + 1}: No correct unitPrice found, skipping`);
            return invLine;
          }

          // Check if price needs updating
          const currentUnitPrice = invLine.unitPrice || 0;
          if (Math.abs(currentUnitPrice - correctUnitPrice) < 0.01) {
            console.log(`  - Line ${idx + 1}: Price already correct (${currentUnitPrice})`);
            return invLine;
          }

          console.log(`  - Line ${idx + 1}: Updating unitPrice from ${currentUnitPrice} to ${correctUnitPrice}`);
          hasChanges = true;

          // Recalculate line amounts with correct price
          const qty = invLine.qty || 0;
          const discountPct = invLine.discountPct || 0;
          const taxRate = invLine.taxRate || 0;

          const newSubtotal = qty * correctUnitPrice;
          const newDiscount = newSubtotal * (discountPct / 100);
          const newNetAmount = newSubtotal - newDiscount;
          const newTaxAmount = newNetAmount * (taxRate / 100);
          const newLineTotal = newNetAmount + newTaxAmount;

          return {
            ...invLine.toObject(),
            unitPrice: correctUnitPrice,
            lineSubtotal: newSubtotal,
            taxAmount: newTaxAmount,
            lineTotal: newLineTotal
          };
        });

        if (hasChanges) {
          // Recalculate invoice totals
          const newSubtotal = updatedLines.reduce((sum, l) => sum + (l.lineSubtotal || 0), 0);
          const newTaxAmount = updatedLines.reduce((sum, l) => sum + (l.taxAmount || 0), 0);
          const newTotal = updatedLines.reduce((sum, l) => sum + (l.lineTotal || 0), 0);

          // Update invoice
          await Invoice.findByIdAndUpdate(invoice._id, {
            lines: updatedLines,
            subtotal: newSubtotal,
            taxAmount: newTaxAmount,
            total: newTotal
          });

          console.log(`  - Updated invoice totals: Subtotal=${newSubtotal}, Tax=${newTaxAmount}, Total=${newTotal}`);
          updatedCount++;
        } else {
          console.log(`  - No changes needed`);
          skippedCount++;
        }

      } catch (error) {
        console.error(`  - Error processing invoice ${invoice._id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total invoices processed: ${invoices.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);

    console.log('\nMigration completed!');
    process.exit(0);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateInvoiceUnitPrices();
