/**
 * Seed default account mappings for all companies.
 * Usage:
 *  - programmatic: require and call `seedAccountMappings(uri)`
 *  - CLI: node scripts/seedAccountMappings.js
 */
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Company = require('../models/Company');
const AccountMapping = require('../models/AccountMapping');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');

async function seedAccountMappings(uri) {
  let connectedHere = false;
  try {
    // If mongoose already connected (e.g., tests), reuse connection
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      connectedHere = false;
    } else if (uri) {
      await mongoose.connect(uri, { useNewUrlParser: true });
      connectedHere = true;
    } else {
      await connectDB();
      connectedHere = false; // connectDB manages connection lifecycle
    }

    const companies = await Company.find({});

    const seeds = [];

    for (const comp of companies) {
      const companyId = comp._id;

      // Basic sales mappings
      seeds.push({ company: companyId, module: 'sales', key: 'accountsReceivable', accountCode: DEFAULT_ACCOUNTS.accountsReceivable });
      seeds.push({ company: companyId, module: 'sales', key: 'salesRevenue', accountCode: DEFAULT_ACCOUNTS.salesRevenue });
      seeds.push({ company: companyId, module: 'sales', key: 'salesReturns', accountCode: DEFAULT_ACCOUNTS.salesReturns });

      // Purchases
      seeds.push({ company: companyId, module: 'purchases', key: 'inventory', accountCode: DEFAULT_ACCOUNTS.inventory });
      seeds.push({ company: companyId, module: 'purchases', key: 'vatReceivable', accountCode: DEFAULT_ACCOUNTS.vatReceivable });
      seeds.push({ company: companyId, module: 'purchases', key: 'accountsPayable', accountCode: DEFAULT_ACCOUNTS.accountsPayable });

      // Tax
      seeds.push({ company: companyId, module: 'tax', key: 'vatPayable', accountCode: DEFAULT_ACCOUNTS.vatPayable });

      // Cash
      seeds.push({ company: companyId, module: 'cash', key: 'cashAtBank', accountCode: DEFAULT_ACCOUNTS.cashAtBank });
      seeds.push({ company: companyId, module: 'cash', key: 'cashInHand', accountCode: DEFAULT_ACCOUNTS.cashInHand });
      seeds.push({ company: companyId, module: 'cash', key: 'mtnMoMo', accountCode: DEFAULT_ACCOUNTS.mtnMoMo });

      // Inventory / COGS
      seeds.push({ company: companyId, module: 'inventory', key: 'costOfGoodsSold', accountCode: DEFAULT_ACCOUNTS.costOfGoodsSold });

      // Report-level mappings (examples of multi-code mappings / ranges / prefixes)
      // Map sales revenue to an array of revenue accounts (Sales + Other Income)
      seeds.push({ company: companyId, module: 'report', key: 'salesRevenue', accountCode: [DEFAULT_ACCOUNTS.salesRevenue, DEFAULT_ACCOUNTS.otherIncome] });
      // Map operating expenses to a numeric range (example) - controller supports range strings like '5000-6999'
      seeds.push({ company: companyId, module: 'report', key: 'operatingExpenses', accountCode: '5000-6999' });
      // Map revenue group by prefix (all 40xx accounts)
      seeds.push({ company: companyId, module: 'report', key: 'revenueGroup', accountCode: '40*' });
    }

    let created = 0;
    for (const s of seeds) {
      try {
        await AccountMapping.findOneAndUpdate(
          { company: s.company, module: s.module, key: s.key },
          { ...s },
          { upsert: true, setDefaultsOnInsert: true }
        );
        created++;
      } catch (err) {
        console.warn('Seed mapping failed', s, err.message);
      }
    }

    return { upserted: created };
  } finally {
    if (connectedHere) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  (async () => {
    try {
      await seedAccountMappings();
      console.log('Seed complete');
      process.exit(0);
    } catch (err) {
      console.error('Seed failed', err);
      process.exit(1);
    }
  })();
}

module.exports = { seedAccountMappings };
