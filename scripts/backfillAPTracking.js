#!/usr/bin/env node
/**
 * Backfill APTransactionLedger records for existing APPayments
 * so Dashboard/Transactions tabs show data.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');
const APPayment = require('../models/APPayment');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stock-management';

async function main() {
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  const payments = await APPayment.find({});
  console.log(`Found ${payments.length} APPayment(s).\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const payment of payments) {
    try {
      const APTrackingService = require('../services/apTrackingService');

      // Check if transaction already exists for this payment
      const APTransactionLedger = require('../models/APTransactionLedger');
      const existing = await APTransactionLedger.findOne({
        payment: payment._id,
        type: 'payment'
      });

      if (existing) {
        console.log(`  [SKIP] ${payment.referenceNo} — tracking transaction already exists`);
        skipped++;
        continue;
      }

      await APTrackingService.recordPaymentPosted(payment, payment.postedBy || payment.createdBy || null);
      console.log(`  [OK] Created tracking transaction for ${payment.referenceNo} — $${parseFloat(payment.amountPaid?.toString?.() || payment.amountPaid).toFixed(2)}`);
      created++;
    } catch (err) {
      console.error(`  [ERR] ${payment.referenceNo}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
