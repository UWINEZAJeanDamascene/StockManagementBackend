const mongoose = require('mongoose');
const path = require('path');

// Set environment before requiring config
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const config = require(path.join(__dirname, '..', 'src/config/environment'));

// Load all models to ensure they're registered with mongoose
require('../models/Company');
require('../models/Client');
require('../models/Warehouse');
require('../models/Invoice');
require('../models/DeliveryNote');
require('../models/Quotation');
require('../models/Product');
require('../models/User');
require('../models/Category');

const DeliveryNote = mongoose.model('DeliveryNote');
const Invoice = mongoose.model('Invoice');

async function testAPI() {
  try {
    const dbUri = config.db.uri;
    await mongoose.connect(dbUri, { 
      maxPoolSize: config.db.maxPoolSize,
      serverSelectionTimeoutMS: config.db.serverSelectionTimeoutMs,
      connectTimeoutMS: config.db.connectTimeoutMs
    });
    console.log('✅ Connected to MongoDB\n');

    const companyId = new mongoose.Types.ObjectId('69cd2a7aa3374f54acd6b63d');

    // Simulate the getDeliveryNotes query
    console.log('🔍 Simulating GET /api/delivery-notes query...\n');

    const deliveryNotes = await DeliveryNote.find({ company: companyId })
      .populate('client', 'name code contact taxId')
      .populate('quotation', 'referenceNo')
      .populate('invoice', 'referenceNo status grandTotal lines currencyCode') // include referenceNo for virtual
      .populate('warehouse', 'name code')
      .populate('lines.product', 'name sku unit')
      .populate('items.product', 'name sku unit')
      .populate('createdBy', 'name email')
      .populate('confirmedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(20);

    console.log(`Found ${deliveryNotes.length} delivery notes\n`);

    // Show raw before enhancement
    console.log('📋 Raw Data (before enhancement) for first note:');
    if (deliveryNotes[0]) {
      const raw = deliveryNotes[0];
      console.log('  referenceNo:', raw.referenceNo);
      console.log('  status:', raw.status);
      console.log('  client.name:', raw.client?.name);
      console.log('  invoice:', raw.invoice);
      console.log('  invoice.invoiceNumber:', raw.invoice?.invoiceNumber);
      console.log('  invoice.status:', raw.invoice?.status);
      console.log('  invoice.grandTotal:', raw.invoice?.grandTotal);
      console.log('  warehouse:', raw.warehouse?.name);
      console.log('  lines count:', raw.lines?.length);
      console.log('  lines[0]:', raw.lines?.[0]);
      console.log('  trackingNo:', raw.trackingNo);
      console.log('  currency (from invoice):', raw.invoice?.currencyCode);
    }

    // Apply the enhanceDeliveryNotes transformation (copy from controller)
    function enhanceDeliveryNotes(deliveryNotes) {
      if (!deliveryNotes) return deliveryNotes;
      const isArray = Array.isArray(deliveryNotes);
      const notes = isArray ? deliveryNotes : [deliveryNotes];

      for (const note of notes) {
        if (!note) continue;

        const lines = (note.lines && note.lines.length > 0) ? note.lines : (note.items || []);

        let grandTotal = 0;
        if (Array.isArray(lines)) {
          for (const line of lines) {
            const qty = (line.qtyToDeliver !== undefined) ? line.qtyToDeliver : (line.deliveredQty || 0);
            const unitCost = line.unitCost || 0;
            const qtyNum = Number(qty) || 0;
            const unitCostNum = Number(unitCost) || 0;
            grandTotal += qtyNum * unitCostNum;
          }
        }
        grandTotal = Math.round(grandTotal * 100) / 100;
        note.grandTotal = grandTotal;

        note.itemsCount = Array.isArray(lines) ? lines.length : 0;
        note.trackingNumber = note.trackingNo;

        if (note.invoice && note.invoice.currencyCode) {
          note.currencyCode = note.invoice.currencyCode;
        } else {
          note.currencyCode = 'USD';
        }
      }

      return isArray ? notes : notes[0];
    }

    const enhanced = enhanceDeliveryNotes(deliveryNotes);

    console.log('\n📋 Delivery Notes Preview:');
    enhanced.forEach((note, idx) => {
      console.log(`\n${idx + 1}. ${note.referenceNo}`);
      console.log(`   Status: ${note.status}`);
      console.log(`   Client: ${note.client?.name || 'N/A'}`);
      console.log(`   Invoice: ${note.invoice?.invoiceNumber || 'N/A'} (status: ${note.invoice?.status || 'N/A'})`);
      console.log(`   Grand Total: ${note.grandTotal} ${note.currencyCode}`);
      console.log(`   Items Count: ${note.itemsCount}`);
      console.log(`   Tracking: ${note.trackingNumber || 'N/A'}`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Test complete');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testAPI();
