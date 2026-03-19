const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const Role = require('../models/Role');
const connectDB = require('../config/database');

async function seed() {
  await connectDB();

  const roles = [
    { name: 'admin', description: 'Full access to all modules', permissions: ['*'] },
    { name: 'accountant', description: 'Can view and post journals, approve financial records', permissions: ['journal.*', 'financial.*'] },
    { name: 'purchaser', description: 'Manage purchase orders and GRNs', permissions: ['purchase.*', 'grn.*'] },
    { name: 'warehouse_manager', description: 'Manage stock, transfers, audits', permissions: ['stock.*', 'inventory.*'] },
    { name: 'viewer', description: 'Read-only access', permissions: ['read.*'] }
  ];

  for (const r of roles) {
    const existing = await Role.findOne({ name: r.name }).lean();
    if (!existing) {
      await Role.create(r);
      console.log('Seeded role:', r.name);
    } else {
      console.log('Role exists:', r.name);
    }
  }

  mongoose.disconnect();
}

seed().catch(err => {
  console.error('Role seed failed', err);
  process.exit(1);
});
