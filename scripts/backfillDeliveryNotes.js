// Set environment variables before importing config
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3000';

const mongoose = require('mongoose');
const config = require('../src/config/environment');

// Load all models to ensure they're registered with mongoose
require('../models/Company');
require('../models/User');
require('../models/Client');
require('../models/Supplier');
require('../models/Product');
require('../models/Category');
require('../models/Warehouse');
require('../models/Invoice');
require('../models/DeliveryNote');
require('../models/Quotation');

// Get references from mongoose.models (after require above registers them)
const Invoice = mongoose.model('Invoice');
const DeliveryNote = mongoose.model('DeliveryNote');
const Client = mongoose.model('Client'); // Not used directly but good to have
const Warehouse = mongoose.model('Warehouse');

const DRY_RUN = process.argv.includes('--dry-run');

async function backfillDeliveryNotes() {
  try {
    // Connect to database
    const dbUri = config.db.uri;
    await mongoose.connect(dbUri, { 
      // These options are from buildMongooseConnectOptions
      maxPoolSize: config.db.maxPoolSize,
      minPoolSize: config.db.minPoolSize,
      serverSelectionTimeoutMS: config.db.serverSelectionTimeoutMs,
      socketTimeoutMS: config.db.socketTimeoutMs,
      connectTimeoutMS: config.db.connectTimeoutMs,
      heartbeatFrequencyMS: config.db.heartbeatFrequencyMs
    });
    console.log('✅ Connected to MongoDB');

    // Find all confirmed invoices that don't have delivery notes yet
    console.log('\n🔍 Finding confirmed invoices without delivery notes...');

    const invoices = await Invoice.find({
      status: { $in: ['confirmed', 'fully_paid', 'partially_paid'] }
    })
    .populate('client', '_id name')
    .populate('lines.product', '_id name sku unit')
    .limit(10);

    console.log(`Found ${invoices.length} confirmed invoices to process`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const invoice of invoices) {
      try {
        // Check if delivery note already exists for this invoice
        const existingDN = await DeliveryNote.findOne({
          invoice: invoice._id,
          company: invoice.company
        });

        if (existingDN) {
          console.log(`  ⏭️  Invoice ${invoice.referenceNo || invoice._id} already has delivery note ${existingDN.referenceNo}`);
          skippedCount++;
          continue;
        }

        // Get warehouse - prefer invoice-level warehouse, then line-level, then default company warehouse
        let warehouse = invoice.warehouse;
        if (!warehouse && invoice.lines && invoice.lines.length > 0) {
          // Try to get warehouse from the first line that has one
          for (const line of invoice.lines) {
            if (line.warehouse) {
              warehouse = line.warehouse;
              break;
            }
          }
        }
        if (!warehouse) {
          // Find any active warehouse for this company
          const wh = await Warehouse.findOne({ company: invoice.company, isActive: true });
          if (wh) {
            warehouse = wh._id;
          }
        }

        if (!warehouse) {
          console.log(`  ⚠️  No warehouse found for invoice ${invoice.referenceNo || invoice._id}, skipping`);
          skippedCount++;
          continue;
        }

        // Build delivery lines from invoice lines
        const deliveryLines = [];
        for (const line of invoice.lines) {
          if (!line.product) continue;

          // Determine qty to deliver based on delivered qty tracking
          const orderedQty = line.quantity || 0;
          const alreadyDelivered = line.qtyDelivered || 0;
          const remainingQty = orderedQty - alreadyDelivered;

          if (remainingQty <= 0) continue;

          deliveryLines.push({
            invoiceLineId: line._id,
            product: line.product._id || line.product,
            productName: line.product.name || line.description || '',
            productCode: line.product.sku || line.itemCode || '',
            unit: line.product.unit || line.unit || 'pcs',
            orderedQty: orderedQty,
            qtyToDeliver: remainingQty,
            deliveredQty: 0,
            pendingQty: remainingQty,
            unitCost: line.unitCost || 0,
            batchId: null,
            serialNumbers: [],
            notes: ''
          });
        }

        if (deliveryLines.length === 0) {
          console.log(`  ⚠️  No lines with remaining quantity for invoice ${invoice.referenceNo || invoice._id}, skipping`);
          skippedCount++;
          continue;
        }

        // Get creator user ID from invoice or use a default
        const createdBy = invoice.createdBy || invoice.createdByUser || null;

        if (!createdBy && !DRY_RUN) {
          console.log(`  ⚠️  No createdBy user for invoice ${invoice.referenceNo || invoice._id}, skipping`);
          skippedCount++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would create delivery note for invoice ${invoice.referenceNo || invoice._id} with ${deliveryLines.length} lines`);
          createdCount++;
          continue;
        }

        // Create the delivery note (draft status)
        const deliveryNote = await DeliveryNote.create({
          company: invoice.company,
          invoice: invoice._id,
          client: invoice.client._id || invoice.client,
          quotation: invoice.quotation || null,
          warehouse,
          carrier: null,
          trackingNo: null,
          deliveryDate: new Date(),
          lines: deliveryLines,
          items: deliveryLines, // Legacy support
          notes: '',
          status: 'draft',
          createdBy: createdBy
        });

        // Generate reference number (triggers pre-save hook)
        await deliveryNote.save();

        console.log(`  ✅ Created delivery note ${deliveryNote.referenceNo} for invoice ${invoice.referenceNo || invoice._id}`);
        createdCount++;

      } catch (err) {
        console.error(`  ❌ Error processing invoice ${invoice.referenceNo || invoice._id}:`, err.message);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Created: ${createdCount} delivery notes`);
    console.log(`   Skipped: ${skippedCount} invoices`);
    if (DRY_RUN) {
      console.log('   (dry run mode - no changes made)');
    }
    console.log('\n✅ Backfill complete!');

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  backfillDeliveryNotes();
}

module.exports = { backfillDeliveryNotes };