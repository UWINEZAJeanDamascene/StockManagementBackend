/*
Seed default AccountMapping entries for a company.
Usage:
  NODE_ENV=test node scripts/seedDefaultAccountMappings.js --company=COMPANY_ID --user=USER_ID

If no company is provided it will exit.
*/
const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const AccountMapping = require('../models/AccountMapping');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');

const argv = yargs(hideBin(process.argv)).argv;

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_tenancy_system';
  const companyId = argv.company;
  const userId = argv.user || null;

  if (!companyId) {
    console.error('Please provide --company=COMPANY_ID');
    process.exit(1);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  const mappings = [
    { module: 'inventory', key: 'inventory', accountCode: DEFAULT_ACCOUNTS.inventory },
    { module: 'inventory', key: 'costOfGoodsSold', accountCode: DEFAULT_ACCOUNTS.costOfGoodsSold },
    { module: 'sales', key: 'salesRevenue', accountCode: DEFAULT_ACCOUNTS.salesRevenue }
  ];

  for (const m of mappings) {
    try {
      const existing = await AccountMapping.findOne({ company: companyId, module: m.module, key: m.key });
      if (existing) {
        console.log(`Skipping existing mapping ${m.module}/${m.key} -> ${existing.accountCode}`);
        continue;
      }

      const doc = await AccountMapping.create({
        company: companyId,
        module: m.module,
        key: m.key,
        accountCode: m.accountCode,
        description: `Default mapping for ${m.module}.${m.key}`,
        createdBy: userId
      });

      console.log(`Created mapping ${m.module}/${m.key} -> ${m.accountCode}`);
    } catch (err) {
      console.error('Failed to create mapping', m, err.message || err);
    }
  }

  await mongoose.disconnect();
  console.log('Done');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
