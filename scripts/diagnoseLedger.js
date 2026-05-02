const mongoose = require('mongoose');
require('dotenv').config();

async function checkLedgerData() {
  try {
    // Connect to DB
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
      console.error('MONGODB_URI not found in environment');
      process.exit(1);
    }
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    // Load required models - simulate server loading order
    // The server requires these in a specific order via route controllers
    const GoodsReceivedNote = require('../models/GoodsReceivedNote');
    const Purchase = require('../models/Purchase');
    // AP models (added to server.js)
    const APTransactionLedger = require('../models/APTransactionLedger');
    const APPayment = require('../models/APPayment');
    const APPaymentAllocation = require('../models/APPaymentAllocation');
    // AR models - arReconciliationController requires ARTrackingService first
    const ARTrackingService = require('../services/arTrackingService'); // this loads Client, Invoice, etc.
    const ARTransactionLedger = require('../models/ARTransactionLedger');
    const ARReceipt = require('../models/ARReceipt');
    const ARReceiptAllocation = require('../models/ARReceiptAllocation');
    const ARBadDebtWriteoff = require('../models/ARBadDebtWriteoff');
    const CreditNote = require('../models/CreditNote');
    // Core models
    const Client = require('../models/Client');
    const Invoice = require('../models/Invoice');
    const Company = require('../models/Company');
    const User = require('../models/User');
    const Supplier = require('../models/Supplier');

    // Check AP Transaction Ledger
    const apCount = await APTransactionLedger.countDocuments();
    console.log(`\nAP Transaction Ledger: ${apCount} total entries`);

    if (apCount > 0) {
      const apSample = await APTransactionLedger.findOne().sort({ createdAt: -1 });
      console.log('Most recent AP transaction:', {
        _id: apSample._id,
        company: apSample.company,
        supplier: apSample.supplier,
        transactionType: apSample.transactionType,
        amount: apSample.amount,
        direction: apSample.direction,
        transactionDate: apSample.transactionDate,
        reconciliationStatus: apSample.reconciliationStatus
      });

      // Check by company
      const apByCompany = await APTransactionLedger.aggregate([
        { $group: { _id: '$company', count: { $sum: 1 } } }
      ]);
      console.log('AP entries by company:', apByCompany);
    }

    // Check AR Transaction Ledger
    const arCount = await ARTransactionLedger.countDocuments();
    console.log(`\nAR Transaction Ledger: ${arCount} total entries`);

    if (arCount > 0) {
      const arSample = await ARTransactionLedger.findOne().sort({ createdAt: -1 });
      console.log('Most recent AR transaction:', {
        _id: arSample._id,
        company: arSample.company,
        client: arSample.client,
        transactionType: arSample.transactionType,
        amount: arSample.amount,
        direction: arSample.direction,
        transactionDate: arSample.transactionDate,
        reconciliationStatus: arSample.reconciliationStatus
      });

      // Check by company
      const arByCompany = await ARTransactionLedger.aggregate([
        { $group: { _id: '$company', count: { $sum: 1 } } }
      ]);
      console.log('AR entries by company:', arByCompany);
    }

    // Check source documents
    const grnCount = await GoodsReceivedNote.countDocuments();
    console.log(`\nGoodsReceivedNotes: ${grnCount}`);
    const invoiceCount = await Invoice.countDocuments();
    console.log(`Invoices: ${invoiceCount}`);

    // Check companies
    const companies = await Company.find({}, '_id name');
    console.log('\nCompanies in DB:');
    companies.forEach(c => console.log(` - ${c._id}: ${c.name}`));

    // Check users and their company
    const users = await User.find({}, '_id email company').limit(5);
    console.log('\nSample users:');
    for (const u of users) {
      console.log(` - ${u.email}: company=${u.company}`);
    }

    // Check if Invoices have associated AR ledger entries
    if (invoiceCount > 0) {
      const invoicesWithOutstanding = await Invoice.countDocuments({
        amountOutstanding: { $gt: 0 }
      });
      console.log(`Invoices with outstanding balance: ${invoicesWithOutstanding}`);

      const invoiceSourceCount = await ARTransactionLedger.countDocuments({
        sourceType: 'invoice'
      });
      console.log(`AR ledger entries from invoice source: ${invoiceSourceCount}`);
    }

    // Simulate controller query for AP and AR transactions
    const testCompanyId = new mongoose.Types.ObjectId('69f0879f0fae56afe731c853');

    // AP getTransactions simulation
    const apQuery = { company: testCompanyId };
    const apTotal = await APTransactionLedger.countDocuments(apQuery);
    console.log(`\nSimulated AP getTransactions count: ${apTotal}`);

    const apTransactions = await APTransactionLedger.find(apQuery)
      .populate('supplier', 'name code')
      .sort({ transactionDate: -1, createdAt: -1 })
      .limit(5);
    console.log(`AP transactions fetched: ${apTransactions.length}`);
    if (apTransactions.length > 0) {
      console.log('First AP transaction (populated):', {
        supplierName: apTransactions[0].supplier?.name,
        referenceNo: apTransactions[0].referenceNo,
        amount: apTransactions[0].amount
      });
    }

    // AR getTransactions simulation
    const arQuery = { company: testCompanyId };
    const arTotal = await ARTransactionLedger.countDocuments(arQuery);
    console.log(`\nSimulated AR getTransactions count: ${arTotal}`);

    const arTransactions = await ARTransactionLedger.find(arQuery)
      .populate('client', 'name code')
      .sort({ transactionDate: -1, createdAt: -1 })
      .limit(5);
    console.log(`AR transactions fetched: ${arTransactions.length}`);
    if (arTransactions.length > 0) {
      console.log('First AR transaction (populated):', {
        clientName: arTransactions[0].client?.name,
        referenceNo: arTransactions[0].referenceNo,
        amount: arTransactions[0].amount
      });
    }

    console.log('\nDiagnostic complete.');
    process.exit(0);

    console.log('\nCheck complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLedgerData();
