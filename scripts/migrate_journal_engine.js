require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_tenancy_system';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true });
  const db = mongoose.connection.db;
  console.log('Connected to', db.databaseName);

  const dryRun = process.argv.includes('--dry-run') || process.env.MIGRATE_DRY === '1';
  if (dryRun) console.log('Running in DRY-RUN mode (no writes will be performed)');

  const coll = db.collection('journalentries');

  // Step 1: Recalculate totals from lines for all documents and fix inconsistencies
  console.log('Step 1: Recalculating totals from lines and fixing inconsistencies...');
  const cursor = coll.find({});
  let fixed = 0;
  let inspected = 0;
  for await (const doc of cursor) {
    inspected++;
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs((doc.totalDebit || 0) - totalDebit) > 0.0001 || Math.abs((doc.totalCredit || 0) - totalCredit) > 0.0001) {
      if (!dryRun) {
        await coll.updateOne({ _id: doc._id }, { $set: { totalDebit, totalCredit } });
        fixed++;
      } else {
        fixed++;
      }
    }
  }
  console.log(`Inspected ${inspected} entries, fixed ${fixed} totals.`);

  // Step 2: Detect duplicates for company+sourceType+sourceId where sourceId exists
  console.log('Step 2: Detecting duplicate source events (company, sourceType, sourceId)...');
  const dupAgg = await coll.aggregate([
    { $match: { sourceId: { $exists: true, $ne: null } } },
    { $group: { _id: { company: '$company', sourceType: '$sourceType', sourceId: '$sourceId' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 }
  ]).toArray();

  if (dupAgg.length > 0) {
    console.error('Found duplicate source events. You must resolve these before creating the unique index. Sample duplicates:');
    dupAgg.forEach(d => {
      console.error(`- company=${d._id.company}, sourceType=${d._id.sourceType}, sourceId=${d._id.sourceId}, count=${d.count}`);
      console.error(`  ids: ${d.ids.slice(0,5).join(', ')}`);
    });
    console.error('Aborting index creation. Resolve duplicates and re-run the migration.');
    process.exitCode = 2;
    await mongoose.disconnect();
    return;
  }

  // Step 3: Create partial unique index
  console.log('Step 3: Creating partial unique index on (company, sourceType, sourceId)...');
  try {
    if (!dryRun) {
      await coll.createIndex(
        { company: 1, sourceType: 1, sourceId: 1 },
        { unique: true, partialFilterExpression: { sourceId: { $exists: true, $ne: null } }, background: false }
      );
      console.log('Partial unique index created successfully.');
    } else {
      console.log('DRY-RUN: Skipping index creation.');
    }
  } catch (err) {
    console.error('Failed to create unique index:', err.message || err);
    process.exitCode = 3;
    await mongoose.disconnect();
    return;
  }

  // Step 4: Apply collection validator to ensure posted entries are balanced
  console.log('Step 4: Applying collection validator to enforce posted entries are balanced...');
  try {
    const validator = {
      $expr: {
        $or: [
          { $ne: ['$status', 'posted'] },
          { $eq: ['$totalDebit', '$totalCredit'] }
        ]
      }
    };

    if (!dryRun) {
      await db.command({
        collMod: 'journalentries',
        validator: validator,
        validationLevel: 'moderate'
      });

      console.log('Collection validator applied (moderate). Note: existing documents were adjusted earlier to match totals.');
    } else {
      console.log('DRY-RUN: Skipping collection validator application.');
    }
  } catch (err) {
    // If collMod not supported or fails, log and continue
    console.error('Failed to apply collection validator:', err.message || err);
    console.warn('You may need to run this command manually depending on MongoDB version/permissions.');
  }

  console.log('Migration completed successfully.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  try { await mongoose.disconnect(); } catch(e) {}
  process.exit(1);
});
