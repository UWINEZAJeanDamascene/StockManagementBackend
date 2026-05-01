#!/usr/bin/env node
/**
 * Migration: Backfill ARReceipt and APPayment records from existing
 * invoice/purchase payments so the AR/AP read-only ledgers show
 * historical data automatically.
 *
 * Usage:
 *   node scripts/migrateAutoLedgerRecords.js --dry-run
 *   node scripts/migrateAutoLedgerRecords.js
 */
const mongoose = require('mongoose');
const argv = require('minimist')(process.argv.slice(2));

// Models
const Invoice = require('../models/Invoice');
const Purchase = require('../models/Purchase');
const ARReceipt = require('../models/ARReceipt');
const ARReceiptAllocation = require('../models/ARReceiptAllocation');
const APPayment = require('../models/APPayment');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stock-management';
const nodeEnv = process.env.NODE_ENV || 'development';

function toNumber(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val);
  if (val && typeof val === 'object' && '$numberDecimal' in val) {
    return parseFloat(val.$numberDecimal);
  }
  return parseFloat(val.toString ? val.toString() : val);
}

function normalizePaymentMethod(pm) {
  if (!pm) return 'other';
  pm = pm.toString().toLowerCase().trim();
  const map = {
    'bank_transfer': 'bank_transfer',
    'bank transfer': 'bank_transfer',
    'cheque': 'cheque',
    'check': 'cheque',
    'cash': 'cash',
    'card': 'card',
    'credit card': 'card',
    'debit card': 'card',
    'mobile_money': 'bank_transfer',
    'mobile money': 'bank_transfer',
    'm-pesa': 'bank_transfer',
    'mpesa': 'bank_transfer',
    'other': 'other',
  };
  return map[pm] || 'other';
}

async function migrateAR(dryRun) {
  console.log('\n=== Migrating AR Receipts from Invoice payments ===');

  const invoices = await Invoice.find({
    payments: { $exists: true, $not: { $size: 0 } }
  }).select('company client payments invoiceNumber currencyCode amountPaid amountOutstanding');

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const inv of invoices) {
    if (!inv.payments || !inv.payments.length) continue;

    for (let i = 0; i < inv.payments.length; i++) {
      const payment = inv.payments[i];
      const amount = toNumber(payment.amount);
      const paymentDate = payment.paidDate || payment.date || payment.createdAt || new Date();
      const paymentMethod = normalizePaymentMethod(payment.paymentMethod);
      const recordedBy = payment.recordedBy || null;

      // Idempotency check: look for existing receipt tied to this invoice
      const existing = await ARReceipt.findOne({
        company: inv.company,
        client: inv.client,
        amountReceived: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
        reference: { $regex: `Invoice #${inv.invoiceNumber}`, $options: 'i' }
      });

      if (existing) {
        skipped++;
        if (dryRun) {
          console.log(`  [SKIP] Invoice #${inv.invoiceNumber} payment ${i + 1} — receipt already exists (${existing.referenceNo})`);
        }
        continue;
      }

      const refNo = `RCP-MIGRATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`;
      const receiptData = {
        company: inv.company,
        client: inv.client,
        receiptDate: paymentDate,
        paymentMethod: paymentMethod,
        bankAccount: null,
        amountReceived: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
        currencyCode: inv.currencyCode || 'USD',
        exchangeRate: mongoose.Types.Decimal128.fromString('1'),
        reference: `Payment for Invoice #${inv.invoiceNumber || inv._id.toString().slice(-8)}`,
        status: 'posted',
        postedBy: recordedBy,
        postedAt: paymentDate,
        notes: `System-migrated receipt for invoice payment`,
        createdBy: recordedBy,
      };

      if (dryRun) {
        console.log(`  [DRY] Would create ARReceipt for Invoice #${inv.invoiceNumber || inv._id.toString().slice(-8)} — $${amount.toFixed(2)}`);
        created++;
        continue;
      }

      try {
        // Bypass schema default to use our deterministic refNo
        const receipt = new ARReceipt({
          ...receiptData,
          referenceNo: refNo
        });
        await receipt.save();

        // Create allocation
        const alloc = new ARReceiptAllocation({
          receipt: receipt._id,
          invoice: inv._id,
          amountAllocated: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
          company: inv.company,
          createdBy: recordedBy,
        });
        await alloc.save();

        console.log(`  [OK] Created ARReceipt ${receipt.referenceNo} for Invoice #${inv.invoiceNumber} — $${amount.toFixed(2)}`);
        created++;
      } catch (err) {
        console.error(`  [ERR] Invoice #${inv.invoiceNumber} payment ${i + 1}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`AR Migration complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  return { created, skipped, errors };
}

async function migrateAP(dryRun) {
  console.log('\n=== Migrating AP Payments from Purchase payments ===');

  const purchases = await Purchase.find({
    payments: { $exists: true, $not: { $size: 0 } }
  }).select('company supplier payments purchaseNumber currencyCode');

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const pur of purchases) {
    if (!pur.payments || !pur.payments.length) continue;

    for (let i = 0; i < pur.payments.length; i++) {
      const payment = pur.payments[i];
      const amount = toNumber(payment.amount);
      const paymentDate = payment.paidDate || payment.date || payment.createdAt || new Date();
      const paymentMethod = normalizePaymentMethod(payment.paymentMethod);
      const recordedBy = payment.recordedBy || null;

      // Idempotency check
      const existing = await APPayment.findOne({
        company: pur.company,
        supplier: pur.supplier,
        amountPaid: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
        reference: { $regex: `Purchase #${pur.purchaseNumber}`, $options: 'i' }
      });

      if (existing) {
        skipped++;
        if (dryRun) {
          console.log(`  [SKIP] Purchase #${pur.purchaseNumber} payment ${i + 1} — payment already exists (${existing.referenceNo})`);
        }
        continue;
      }

      const refNo = `PAY-MIGRATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`;
      const paymentData = {
        company: pur.company,
        supplier: pur.supplier,
        paymentDate: paymentDate,
        paymentMethod: paymentMethod,
        bankAccount: null,
        amountPaid: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
        currencyCode: pur.currencyCode || 'USD',
        exchangeRate: mongoose.Types.Decimal128.fromString('1'),
        referenceNo: refNo,
        reference: `Payment for Purchase #${pur.purchaseNumber}`,
        status: 'posted',
        postedBy: recordedBy,
        postedAt: paymentDate,
        notes: `System-migrated payment for purchase`,
        createdBy: recordedBy,
      };

      if (dryRun) {
        console.log(`  [DRY] Would create APPayment for Purchase #${pur.purchaseNumber} — $${amount.toFixed(2)}`);
        created++;
        continue;
      }

      try {
        const paymentDoc = new APPayment(paymentData);
        await paymentDoc.save();
        console.log(`  [OK] Created APPayment ${paymentDoc.referenceNo} for Purchase #${pur.purchaseNumber} — $${amount.toFixed(2)}`);
        created++;
      } catch (err) {
        console.error(`  [ERR] Purchase #${pur.purchaseNumber} payment ${i + 1}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`AP Migration complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  return { created, skipped, errors };
}

async function main() {
  const dryRun = argv['dry-run'] !== false && argv.d !== false;

  console.log(`Connecting to ${mongoUri} ...`);
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  if (dryRun) {
    console.log('\n*** DRY RUN — no writes will be performed ***');
  }

  const ar = await migrateAR(dryRun);
  const ap = await migrateAP(dryRun);

  console.log('\n=== Summary ===');
  console.log(`AR Receipts: ${ar.created} created, ${ar.skipped} skipped, ${ar.errors} errors`);
  console.log(`AP Payments:  ${ap.created} created, ${ap.skipped} skipped, ${ap.errors} errors`);

  await mongoose.disconnect();
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err);
    process.exitCode = 2;
    mongoose.disconnect().catch(() => {});
  });
}
