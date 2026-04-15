// Seed test budgets for April 2026
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_management';

async function seedBudgets() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const Budget = mongoose.model('Budget', new mongoose.Schema({
    company_id: mongoose.Schema.Types.ObjectId,
    name: String,
    description: String,
    type: { type: String, enum: ['revenue', 'expense', 'profit'] },
    fiscal_year: Number,
    periodStart: Date,
    periodEnd: Date,
    periodType: { type: String, default: 'monthly' },
    amount: mongoose.Schema.Types.Decimal128,
    category: String,
    status: { type: String, default: 'active' },
    created_by: mongoose.Schema.Types.ObjectId
  }, { timestamps: true }));

  // Get company ID from the first bank account or use a test ID
  const BankAccount = mongoose.model('BankAccount', new mongoose.Schema({
    company: mongoose.Schema.Types.ObjectId
  }, { strict: false }));
  
  const account = await BankAccount.findOne();
  const companyId = account?.company || new mongoose.Types.ObjectId();
  
  // Get admin user
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const user = await User.findOne();
  const userId = user?._id || new mongoose.Types.ObjectId();

  // April 2026 date range
  const periodStart = new Date('2026-04-01');
  const periodEnd = new Date('2026-04-30');

  const budgets = [
    {
      company_id: companyId,
      name: 'April 2026 Revenue Budget',
      description: 'Monthly revenue target for April 2026',
      type: 'revenue',
      fiscal_year: 2026,
      periodStart,
      periodEnd,
      periodType: 'monthly',
      amount: mongoose.Types.Decimal128.fromString('5000000'), // 5M RWF
      category: 'Revenue',
      status: 'active',
      created_by: userId
    },
    {
      company_id: companyId,
      name: 'April 2026 Payroll Budget',
      description: 'Monthly payroll expenses',
      type: 'expense',
      fiscal_year: 2026,
      periodStart,
      periodEnd,
      periodType: 'monthly',
      amount: mongoose.Types.Decimal128.fromString('1500000'), // 1.5M RWF
      category: 'Payroll',
      status: 'active',
      created_by: userId
    },
    {
      company_id: companyId,
      name: 'April 2026 Operations Budget',
      description: 'Monthly operations expenses',
      type: 'expense',
      fiscal_year: 2026,
      periodStart,
      periodEnd,
      periodType: 'monthly',
      amount: mongoose.Types.Decimal128.fromString('800000'), // 800K RWF
      category: 'Operations',
      status: 'active',
      created_by: userId
    },
    {
      company_id: companyId,
      name: 'April 2026 Marketing Budget',
      description: 'Monthly marketing expenses',
      type: 'expense',
      fiscal_year: 2026,
      periodStart,
      periodEnd,
      periodType: 'monthly',
      amount: mongoose.Types.Decimal128.fromString('500000'), // 500K RWF
      category: 'Marketing',
      status: 'active',
      created_by: userId
    }
  ];

  // Clear existing budgets for April 2026
  await Budget.deleteMany({
    company_id: companyId,
    fiscal_year: 2026,
    periodStart: { $gte: new Date('2026-04-01'), $lt: new Date('2026-05-01') }
  });

  // Insert new budgets
  const result = await Budget.insertMany(budgets);
  console.log(`Inserted ${result.length} budgets for April 2026`);
  
  result.forEach(b => {
    console.log(`  - ${b.name}: ${b.type} ${b.amount} (${b.category})`);
  });

  await mongoose.disconnect();
  console.log('Done');
}

seedBudgets().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
