/**
 * Script to generate sample budget data for testing
 * Run with: node Stock-management/scripts/generate_sample_budgets.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock-management';
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Define Budget Schema (inline since we need to create it without the full model)
const budgetSchema = new mongoose.Schema({
  budgetId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  type: { type: String, enum: ['revenue', 'expense', 'profit'], required: true },
  status: { type: String, enum: ['draft', 'active', 'closed', 'cancelled'], default: 'draft' },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  periodType: { type: String, enum: ['monthly', 'quarterly', 'yearly', 'custom'], default: 'monthly' },
  amount: { type: Number, required: true },
  originalAmount: { type: Number, required: true },
  adjustedAmount: Number,
  items: [{
    category: String,
    subcategory: String,
    description: String,
    budgetedAmount: Number
  }],
  department: String,
  notes: String,
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: {
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String
  },
  approvedAt: Date,
  rejectionReason: String,
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String
  },
  updatedBy: {
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String
  },
  version: { type: Number, default: 1 },
  previousVersion: mongoose.Schema.Types.ObjectId
}, { timestamps: true });

budgetSchema.index({ company: 1, status: 1 });
budgetSchema.index({ company: 1, periodStart: 1, periodEnd: 1 });

async function generateSampleBudgets() {
  await connectDB();

  try {
    // Get a company ID (first company in database)
    const Company = mongoose.model('Company', new mongoose.Schema({
      name: String,
      email: String,
      tin: String
    }));
    
    const company = await Company.findOne();
    if (!company) {
      console.log('No company found. Please create a company first.');
      process.exit(1);
    }
    
    console.log(`Using company: ${company.name} (${company._id})`);

    // Get a user ID for createdBy
    const User = mongoose.model('User', new mongoose.Schema({
      name: String,
      email: String
    }));
    
    const user = await User.findOne({ company: company._id });
    const userId = user ? user._id : new mongoose.Types.ObjectId();
    const userName = user ? user.name : 'Admin';
    const userEmail = user ? user.email : 'admin@example.com';

    // Create Budget model
    const Budget = mongoose.models.Budget || mongoose.model('Budget', budgetSchema);

    // Sample budgets to create
    const sampleBudgets = [
      {
        name: 'Q1 2026 Revenue Budget',
        description: 'Revenue budget for Q1 2026',
        company: company._id,
        type: 'revenue',
        status: 'active',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        periodType: 'quarterly',
        amount: 150000,
        originalAmount: 150000,
        adjustedAmount: 150000,
        items: [
          { category: 'sales', subcategory: 'Electronics', description: 'Sales revenue from electronics', budgetedAmount: 80000 },
          { category: 'sales', subcategory: 'Accessories', description: 'Sales revenue from accessories', budgetedAmount: 30000 },
          { category: 'other', subcategory: 'Installation', description: 'Installation services', budgetedAmount: 25000 },
          { category: 'other', subcategory: 'Maintenance', description: 'Maintenance contracts', budgetedAmount: 15000 }
        ],
        department: 'Sales',
        notes: 'Q1 2026 revenue targets',
        approvalStatus: 'approved',
        approvedBy: { _id: userId, name: userName, email: userEmail },
        approvedAt: new Date('2025-12-15'),
        createdBy: { _id: userId, name: userName, email: userEmail },
        version: 1
      },
      {
        name: 'Q1 2026 Operating Expenses',
        description: 'Operating expenses budget for Q1 2026',
        company: company._id,
        type: 'expense',
        status: 'active',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        periodType: 'quarterly',
        amount: 80000,
        originalAmount: 80000,
        adjustedAmount: 80000,
        items: [
          { category: 'operating_expenses', description: 'Staff salaries', budgetedAmount: 45000 },
          { category: 'rent', description: 'Office and warehouse rent', budgetedAmount: 12000 },
          { category: 'utilities', description: 'Electricity, water, internet', budgetedAmount: 5000 },
          { category: 'marketing', description: 'Advertising and promotions', budgetedAmount: 8000 },
          { category: 'other', description: 'Delivery and transportation', budgetedAmount: 6000 },
          { category: 'other', description: 'Stationery and supplies', budgetedAmount: 2000 },
          { category: 'other', description: 'Business insurance', budgetedAmount: 2000 }
        ],
        department: 'Operations',
        notes: 'Q1 2026 expense budget',
        approvalStatus: 'approved',
        approvedBy: { _id: userId, name: userName, email: userEmail },
        approvedAt: new Date('2025-12-15'),
        createdBy: { _id: userId, name: userName, email: userEmail },
        version: 1
      },
      {
        name: 'March 2026 Monthly Budget',
        description: 'Monthly revenue and expense budget for March 2026',
        company: company._id,
        type: 'profit',
        status: 'active',
        periodStart: new Date('2026-03-01'),
        periodEnd: new Date('2026-03-31'),
        periodType: 'monthly',
        amount: 25000,
        originalAmount: 25000,
        adjustedAmount: 25000,
        items: [
          { category: 'sales', description: 'Expected sales revenue', budgetedAmount: 55000 },
          { category: 'purchases', description: 'Cost of goods sold', budgetedAmount: 30000 }
        ],
        department: 'Finance',
        notes: 'March 2026 monthly profit target',
        approvalStatus: 'approved',
        approvedBy: { _id: userId, name: userName, email: userEmail },
        approvedAt: new Date('2026-02-28'),
        createdBy: { _id: userId, name: userName, email: userEmail },
        version: 1
      },
      {
        name: '2026 Annual Revenue Budget',
        description: 'Annual revenue budget for 2026',
        company: company._id,
        type: 'revenue',
        status: 'active',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        periodType: 'yearly',
        amount: 600000,
        originalAmount: 600000,
        adjustedAmount: 600000,
        items: [
          { category: 'sales', description: 'Total product sales', budgetedAmount: 400000 },
          { category: 'other', description: 'Service revenue', budgetedAmount: 150000 },
          { category: 'other', description: 'Miscellaneous income', budgetedAmount: 50000 }
        ],
        department: 'Sales',
        notes: '2026 annual revenue target',
        approvalStatus: 'approved',
        approvedBy: { _id: userId, name: userName, email: userEmail },
        approvedAt: new Date('2025-12-01'),
        createdBy: { _id: userId, name: userName, email: userEmail },
        version: 1
      },
      {
        name: 'April 2026 Marketing Budget',
        description: 'Marketing expenses for April 2026',
        company: company._id,
        type: 'expense',
        status: 'draft',
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-04-30'),
        periodType: 'monthly',
        amount: 5000,
        originalAmount: 5000,
        items: [
          { category: 'marketing', description: 'Online advertising', budgetedAmount: 2000 },
          { category: 'marketing', description: 'Social media campaigns', budgetedAmount: 1000 },
          { category: 'marketing', description: 'Trade shows and events', budgetedAmount: 1500 },
          { category: 'marketing', description: 'Print advertising', budgetedAmount: 500 }
        ],
        department: 'Marketing',
        notes: 'April marketing spend plan',
        approvalStatus: 'pending',
        createdBy: { _id: userId, name: userName, email: userEmail },
        version: 1
      }
    ];

    // Generate budget IDs and save
    const currentYear = new Date().getFullYear();
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    
    for (let i = 0; i < sampleBudgets.length; i++) {
      const budget = sampleBudgets[i];
      const budgetNumber = String(i + 1).padStart(4, '0');
      budget.budgetId = `BUD-${currentYear}${currentMonth}-${budgetNumber}`;
      
      // Check if budget already exists
      const existing = await Budget.findOne({ budgetId: budget.budgetId, company: company._id });
      if (existing) {
        console.log(`Budget ${budget.budgetId} already exists, skipping...`);
        continue;
      }
      
      await Budget.create(budget);
      console.log(`Created budget: ${budget.name} (${budget.budgetId})`);
    }

    // List all budgets
    console.log('\n--- All Budgets ---');
    const allBudgets = await Budget.find({ company: company._id }).sort({ createdAt: -1 });
    allBudgets.forEach(b => {
      console.log(`- ${b.name} | ${b.budgetId} | ${b.type} | ${b.status} | ${b.approvalStatus} | $${b.amount.toLocaleString()}`);
    });

    console.log(`\nTotal budgets created: ${allBudgets.length}`);
    console.log('\nSample data generation complete!');

  } catch (error) {
    console.error('Error generating sample budgets:', error);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
    process.exit(0);
  }
}

generateSampleBudgets();
