#!/usr/bin/env node
/**
 * Backfill AccountBalance collection from existing posted JournalEntry documents.
 * Usage: node scripts/backfill_account_balances.js --dry-run
 */
const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const AccountBalance = require('../models/AccountBalance');
const argv = require('minimist')(process.argv.slice(2));

async function backfill(dryRun = true) {
  console.log(`Starting backfill (dryRun=${dryRun})`);
  const companies = await JournalEntry.distinct('company', { status: 'posted' });
  for (const companyId of companies) {
    console.log('Processing company', companyId.toString());
    const agg = await JournalEntry.aggregate([
      { $match: { company: mongoose.Types.ObjectId(companyId), status: 'posted' } },
      { $unwind: '$lines' },
      { $group: {
        _id: { accountCode: '$lines.accountCode' },
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } }
      } },
    ]);

    for (const row of agg) {
      const accountCode = row._id.accountCode;
      const debit = row.debit || 0;
      const credit = row.credit || 0;
      if (dryRun) {
        console.log(`DRY: company=${companyId} account=${accountCode} debit=${debit} credit=${credit}`);
      } else {
        await AccountBalance.findOneAndUpdate(
          { company: companyId, accountCode },
          { $set: { debit, credit, updatedAt: new Date() } },
          { upsert: true }
        );
        console.log(`WROTE: company=${companyId} account=${accountCode} debit=${debit} credit=${credit}`);
      }
    }
  }
  console.log('Backfill complete');
}

async function main() {
  const dryRun = argv['dry-run'] !== undefined || argv.dry === undefined ? true : !argv.dry;
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/stock_test';
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await backfill(dryRun);
  } catch (err) {
    console.error('Backfill failed', err);
    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main();
