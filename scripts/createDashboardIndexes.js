/**
 * Dashboard Indexes Creation Script
 * 
 * Run once before deploying dashboard endpoints:
 * node scripts/createDashboardIndexes.js
 * 
 * These indexes are mandatory for dashboard queries to meet the 500ms performance requirement.
 */

const mongoose = require('mongoose');

async function createIndexes() {
  // Connect to the database
  const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI or MONGO_URI environment variable is required');
    process.exit(1);
  }
  
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // journal_entries indexes
  console.log('Creating journal_entries indexes...');
  await db.collection('journalentries').createIndexes([
    { key: { company: 1, status: 1, date: -1 } },
    { key: { company: 1, sourceType: 1, date: -1 } },
    { key: { company: 1, status: 1, sourceType: 1, date: -1 } }
  ]);

  // chart_of_accounts indexes
  console.log('Creating chart_of_accounts indexes...');
  await db.collection('chartofaccounts').createIndexes([
    { key: { company: 1, code: 1 } },
    { key: { company: 1, type: 1, subtype: 1 } }
  ]);

  // sales_invoices indexes
  console.log('Creating sales_invoices indexes...');
  await db.collection('salesinvoices').createIndexes([
    { key: { company: 1, status: 1 } },
    { key: { company: 1, status: 1, dueDate: 1 } },
    { key: { company: 1, date: -1 } },
    { key: { company: 1, client: 1, status: 1 } }
  ]);

  // purchase_orders indexes
  console.log('Creating purchase_orders indexes...');
  await db.collection('purchaseorders').createIndexes([
    { key: { company: 1, status: 1 } },
    { key: { company: 1, status: 1, orderDate: -1 } }
  ]);

  // goods_received_notes indexes
  console.log('Creating goods_received_notes indexes...');
  await db.collection('goodsreceivednotes').createIndexes([
    { key: { company: 1, status: 1 } },
    { key: { company: 1, paymentStatus: 1 } }
  ]);

  // stock_levels indexes (using InventoryBatch model typically)
  console.log('Creating stock_levels indexes...');
  await db.collection('inventorybatches').createIndexes([
    { key: { company: 1, availableQuantity: 1 } },
    { key: { company: 1, product: 1, warehouse: 1 } }
  ]);

  // stock_movements indexes
  console.log('Creating stock_movements indexes...');
  await db.collection('stockmovements').createIndexes([
    { key: { company: 1, movementType: 1, createdAt: -1 } },
    { key: { company: 1, product: 1, createdAt: -1 } }
  ]);

  // budget_lines indexes
  console.log('Creating budget_lines indexes...');
  await db.collection('budgetlines').createIndexes([
    { key: { company: 1, budget: 1, periodYear: 1, periodMonth: 1 } }
  ]);

  // bank_accounts indexes
  console.log('Creating bank_accounts indexes...');
  await db.collection('bankaccounts').createIndexes([
    { key: { company: 1, isActive: 1 } },
    { key: { company: 1, currency: 1 } }
  ]);

  console.log('\n✅ All dashboard indexes created successfully!');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

createIndexes().catch(err => {
  console.error('Error creating indexes:', err);
  process.exit(1);
});
