#!/usr/bin/env node
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Purchase = require('../models/Purchase');

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stock-management';
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  const totalInvoices = await Invoice.countDocuments();
  const invoicesWithPayments = await Invoice.countDocuments({ payments: { $exists: true } });
  const invoicesWithNonEmptyPayments = await Invoice.countDocuments({ 'payments.0': { $exists: true } });

  console.log('=== INVOICES ===');
  console.log(`Total invoices: ${totalInvoices}`);
  console.log(`Invoices with payments field: ${invoicesWithPayments}`);
  console.log(`Invoices with non-empty payments: ${invoicesWithNonEmptyPayments}`);

  if (invoicesWithNonEmptyPayments > 0) {
    const sample = await Invoice.findOne({ 'payments.0': { $exists: true } }).select('invoiceNumber payments company client');
    console.log('\nSample invoice:');
    console.log(JSON.stringify(sample, null, 2));
  }

  const totalPurchases = await Purchase.countDocuments();
  const purchasesWithPayments = await Purchase.countDocuments({ payments: { $exists: true } });
  const purchasesWithNonEmptyPayments = await Purchase.countDocuments({ 'payments.0': { $exists: true } });

  console.log('\n=== PURCHASES ===');
  console.log(`Total purchases: ${totalPurchases}`);
  console.log(`Purchases with payments field: ${purchasesWithPayments}`);
  console.log(`Purchases with non-empty payments: ${purchasesWithNonEmptyPayments}`);

  if (purchasesWithNonEmptyPayments > 0) {
    const sample = await Purchase.findOne({ 'payments.0': { $exists: true } }).select('purchaseNumber payments company supplier');
    console.log('\nSample purchase:');
    console.log(JSON.stringify(sample, null, 2));
  }

  await mongoose.disconnect();
}

main().catch(console.error);
