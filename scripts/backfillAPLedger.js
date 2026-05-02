#!/usr/bin/env node
// Backfill APTransactionLedger from existing GRNs and Purchases
// Usage: node scripts/backfillAPLedger.js [--company companyId]

require('dotenv').config();
const connectDB = require('../config/database');
const mongoose = require('mongoose');

async function main() {
  await connectDB();

  // Load models
  const GoodsReceivedNote = require('../models/GoodsReceivedNote');
  const Purchase = require('../models/Purchase');
  const APTransactionLedger = require('../models/APTransactionLedger');
  const Supplier = require('../models/Supplier');

  const args = process.argv.slice(2);
  let companyFilter = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--company' && args[i+1]) {
      companyFilter.company = mongoose.Types.ObjectId(args[i+1]);
    }
  }

  try {
    console.log('[Backfill] Starting AP ledger backfill...');

    // Backfill GRNs
    const grnQuery = { balance: { $gte: 0 }, ...(companyFilter.company ? { company: companyFilter.company } : {}) };
    const grns = await GoodsReceivedNote.find(grnQuery).populate('supplier');
    let createdGRN = 0;

    for (const grn of grns) {
      const exists = await APTransactionLedger.findOne({ sourceType: 'grn', sourceId: grn._id });
      if (exists) continue;

      const supplierId = grn.supplier || grn.supplierId || null;
      const amount = parseFloat(grn.totalAmount || 0) || 0;
      const currentBalanceEntry = await APTransactionLedger.findOne({ company: grn.company, supplier: supplierId }).sort({ transactionDate: -1, createdAt: -1 });
      const currentBalance = currentBalanceEntry ? parseFloat(currentBalanceEntry.supplierBalanceAfter || 0) : 0;
      const newBalance = currentBalance + amount;

      await APTransactionLedger.create({
        company: grn.company,
        supplier: supplierId,
        transactionType: 'grn_received',
        transactionDate: grn.receivedDate || new Date(),
        referenceNo: grn.referenceNo || grn.grnNumber,
        description: `Backfilled GRN ${grn.referenceNo || grn.grnNumber}`,
        amount: amount,
        direction: 'increase',
        supplierBalanceAfter: newBalance,
        grnBalanceAfter: parseFloat(grn.balance || 0) || 0,
        grn: grn._id,
        sourceType: 'grn',
        sourceId: grn._id,
        sourceReference: grn.referenceNo || grn.grnNumber,
        createdBy: new mongoose.Types.ObjectId(),
        reconciliationStatus: 'verified'
      });

      createdGRN++;
    }

    console.log(`[Backfill] GRNs processed: ${grns.length}, new ledger entries: ${createdGRN}`);

    // Backfill Purchases
    const purchaseQuery = { balance: { $gte: 0 }, ...(companyFilter.company ? { company: companyFilter.company } : {}) };
    const purchases = await Purchase.find(purchaseQuery).populate('supplier');
    let createdPurch = 0;

    for (const p of purchases) {
      const exists = await APTransactionLedger.findOne({ sourceType: 'purchase', sourceId: p._id });
      if (exists) continue;

      const supplierId = p.supplier || p.supplierId || null;
      const amount = parseFloat(p.roundedAmount || p.grandTotal || 0) || 0;
      const currentBalanceEntry = await APTransactionLedger.findOne({ company: p.company, supplier: supplierId }).sort({ transactionDate: -1, createdAt: -1 });
      const currentBalance = currentBalanceEntry ? parseFloat(currentBalanceEntry.supplierBalanceAfter || 0) : 0;
      const newBalance = currentBalance + amount;

      await APTransactionLedger.create({
        company: p.company,
        supplier: supplierId,
        transactionType: 'grn_received',
        transactionDate: p.purchaseDate || p.receivedDate || new Date(),
        referenceNo: p.purchaseNumber || p.supplierInvoiceNumber,
        description: `Backfilled Purchase ${p.purchaseNumber || p._id}`,
        amount: amount,
        direction: 'increase',
        supplierBalanceAfter: newBalance,
        grnBalanceAfter: null,
        sourceType: 'manual',
        sourceId: p._id,
        sourceReference: p.purchaseNumber || p.supplierInvoiceNumber,
        createdBy: new mongoose.Types.ObjectId(),
        reconciliationStatus: 'verified'
      });

      createdPurch++;
    }

    console.log(`[Backfill] Purchases processed: ${purchases.length}, new ledger entries: ${createdPurch}`);

    console.log('[Backfill] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[Backfill] Error:', err);
    process.exit(1);
  }
}

main();
