const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Company = require('../models/Company');
const ChartOfAccount = require('../models/ChartOfAccount');
const { CHART_OF_ACCOUNTS } = require('../constants/chartOfAccounts');

dotenv.config();

const migrateChartOfAccounts = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected...');

    // Get all active companies
    const companies = await Company.find({ isActive: true }).select('_id name');
    console.log(`Found ${companies.length} active companies`);

    for (const company of companies) {
      // Check if company already has accounts
      const existingCount = await ChartOfAccount.countDocuments({ company: company._id });
      
      if (existingCount > 0) {
        console.log(`Company "${company.name}" (${company._id}) already has ${existingCount} accounts. Skipping.`);
        continue;
      }

      // Seed chart of accounts
      const accounts = Object.entries(CHART_OF_ACCOUNTS).map(([code, account]) => ({
        company: company._id,
        code,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        normal_balance: account.normalBalance,
        allow_direct_posting: account.allowDirectPosting,
        isActive: true,
        createdBy: null,
      }));

      await ChartOfAccount.insertMany(accounts);
      console.log(`Seeded ${accounts.length} accounts for company "${company.name}" (${company._id})`);
    }

    console.log('Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
};

migrateChartOfAccounts();
