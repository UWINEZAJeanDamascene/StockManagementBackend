const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ChartOfAccount = require('../models/ChartOfAccount');
const { CHART_OF_ACCOUNTS } = require('../constants/chartOfAccounts');

dotenv.config();

const seedChartOfAccounts = async (companyId, userId) => {
  try {
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('MongoDB Connected...');
    }

    if (!companyId) {
      console.error('Error: companyId is required');
      process.exit(1);
    }

    console.log(`Seeding chart of accounts for company: ${companyId}`);

    // Check if accounts already exist for this company
    const existingCount = await ChartOfAccount.countDocuments({ company: companyId });
    if (existingCount > 0) {
      console.log(`Company already has ${existingCount} accounts. Skipping seed.`);
      process.exit(0);
    }

    // Transform and insert accounts
    const accounts = Object.entries(CHART_OF_ACCOUNTS).map(([code, account]) => ({
      company: companyId,
      code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      normal_balance: account.normalBalance,
      allow_direct_posting: account.allowDirectPosting,
      isActive: true,
      createdBy: userId || null,
    }));

    const result = await ChartOfAccount.insertMany(accounts);
    console.log(`Successfully seeded ${result.length} chart of accounts`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding chart of accounts:', error);
    process.exit(1);
  }
};

// If run directly, use command line arguments
if (require.main === module) {
  const companyId = process.argv[2];
  const userId = process.argv[3];
  seedChartOfAccounts(companyId, userId);
}

module.exports = seedChartOfAccounts;
