require('dotenv').config();
const connectDB = require('../config/database');
const mongoose = require('mongoose');

async function main() {
  await connectDB();
  // Ensure models are registered
  require('../models/Supplier');
  const APTransactionLedger = require('../models/APTransactionLedger');

  const rows = await APTransactionLedger.find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('supplier', 'name code')
    .lean();

  console.log('Recent APTransactionLedger entries:');
  rows.forEach(r => {
    console.log(JSON.stringify({
      _id: r._id,
      company: String(r.company),
      supplier: r.supplier ? r.supplier.name : null,
      transactionType: r.transactionType,
      amount: r.amount ? parseFloat(r.amount.toString()) : 0,
      supplierBalanceAfter: r.supplierBalanceAfter ? parseFloat(r.supplierBalanceAfter.toString()) : 0,
      sourceType: r.sourceType,
      sourceId: String(r.sourceId),
      createdAt: r.createdAt
    }));
  });
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
