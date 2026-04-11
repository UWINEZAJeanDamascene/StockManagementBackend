require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  try {
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_tenancy_system';
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const JournalEntry = require('../models/JournalEntry');
    const companyId = process.argv[2];
    const asOf = process.argv[3] ? new Date(process.argv[3]) : new Date();
    if (!companyId) { console.error('Usage: node agg_account_balances.js <companyId> [asOfDate]'); process.exit(1); }
    const { ObjectId } = require('mongodb');
    const ag = await JournalEntry.aggregate([
      { $match: { company: new ObjectId(companyId), status: 'posted', reversed: { $ne: true }, date: { $lte: asOf } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.accountCode', total_dr: { $sum: '$lines.debit' }, total_cr: { $sum: '$lines.credit' } } }
    ]);
    console.log('Aggregate result:', JSON.stringify(ag, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('agg failed:', err.message || err);
    process.exit(2);
  } finally { try { await mongoose.disconnect(); } catch(e){} }
})();
