/**
 * Seeds system roles into the database.
 * Run this before creating platform admin or any users.
 *   node scripts/seedSystemRoles.js
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Role = require('../models/Role');

const systemRoles = [
  {
    name: 'platform_admin',
    description: 'Platform administrator with full system access',
    is_system_role: true,
    permissions: [
      { resource: '*', actions: ['*'] } // Full access to everything
    ]
  },
  {
    name: 'admin',
    description: 'Company administrator with full company access',
    is_system_role: true,
    permissions: [
      { resource: '*', actions: ['read', 'create', 'update', 'delete', 'approve', 'post'] }
    ]
  },
  {
    name: 'manager',
    description: 'Manager with access to manage teams and operations',
    is_system_role: true,
    permissions: [
      { resource: 'products', actions: ['read', 'create', 'update'] },
      { resource: 'invoices', actions: ['read', 'create', 'update'] },
      { resource: 'users', actions: ['read', 'create', 'update'] },
      { resource: 'reports', actions: ['read'] }
    ]
  },
  {
    name: 'stock_manager',
    description: 'Stock manager with inventory control access',
    is_system_role: true,
    permissions: [
      { resource: 'products', actions: ['read', 'create', 'update', 'delete'] },
      { resource: 'stock', actions: ['read', 'create', 'update'] },
      { resource: 'suppliers', actions: ['read', 'create', 'update'] }
    ]
  },
  {
    name: 'sales',
    description: 'Sales representative',
    is_system_role: true,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'clients', actions: ['read', 'create', 'update'] },
      { resource: 'invoices', actions: ['read', 'create'] },
      { resource: 'quotations', actions: ['read', 'create', 'update'] }
    ]
  },
  {
    name: 'viewer',
    description: 'Read-only access',
    is_system_role: true,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'invoices', actions: ['read'] },
      { resource: 'reports', actions: ['read'] }
    ]
  },
  {
    name: 'accountant',
    description: 'Accounting and financial access',
    is_system_role: true,
    permissions: [
      { resource: 'journal_entries', actions: ['read', 'create', 'update', 'post'] },
      { resource: 'invoices', actions: ['read'] },
      { resource: 'reports', actions: ['read'] },
      { resource: 'accounting', actions: ['read', 'create', 'update', 'post'] }
    ]
  },
  {
    name: 'purchaser',
    description: 'Purchase order and supplier management',
    is_system_role: true,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'suppliers', actions: ['read', 'create', 'update'] },
      { resource: 'purchases', actions: ['read', 'create', 'update'] }
    ]
  },
  {
    name: 'warehouse_manager',
    description: 'Warehouse and logistics management',
    is_system_role: true,
    permissions: [
      { resource: 'stock', actions: ['read', 'create', 'update'] },
      { resource: 'stock_transfers', actions: ['read', 'create', 'update'] },
      { resource: 'delivery_notes', actions: ['read', 'create', 'update'] }
    ]
  }
];

async function run() {
  await connectDB();

  console.log('Seeding system roles...\n');

  for (const roleData of systemRoles) {
    const existing = await Role.findOne({ name: roleData.name, is_system_role: true });
    if (existing) {
      console.log(`Role "${roleData.name}" already exists - skipping.`);
      continue;
    }

    await Role.create(roleData);
    console.log(`Created role: ${roleData.name}`);
  }

  console.log('\nSystem roles seeded successfully!');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Error seeding roles:', err);
  process.exit(1);
});
