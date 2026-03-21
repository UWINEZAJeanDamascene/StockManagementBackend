/**
 * Role Seeding Script
 * Seeds system roles into the database
 * Run: node scripts/seedRoles.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const Role = require('../models/Role');
const connectDB = require('../config/database');

const SYSTEM_ROLES = [
  {
    name: 'admin',
    description: 'Full access to all modules and settings',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: '*', actions: ['read', 'create', 'update', 'delete', 'approve', 'post', 'reverse'] }
    ]
  },
  {
    name: 'accountant',
    description: 'Full accounting access — can post, reverse, close periods',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'stock', actions: ['read'] },
      { resource: 'purchase_orders', actions: ['read'] },
      { resource: 'sales_invoices', actions: ['read', 'create', 'update', 'approve'] },
      { resource: 'journal_entries', actions: ['read', 'create', 'reverse'] },
      { resource: 'chart_of_accounts', actions: ['read', 'create', 'update'] },
      { resource: 'periods', actions: ['read', 'create', 'close', 'reopen'] },
      { resource: 'bank_accounts', actions: ['read', 'create', 'update'] },
      { resource: 'ar_receipts', actions: ['read', 'create', 'post', 'reverse'] },
      { resource: 'ap_payments', actions: ['read', 'create', 'post', 'reverse'] },
      { resource: 'payroll', actions: ['read', 'create', 'post', 'reverse'] },
      { resource: 'reports', actions: ['read'] },
      { resource: 'budgets', actions: ['read', 'create', 'update', 'approve'] },
      { resource: 'expenses', actions: ['read', 'create', 'post', 'reverse'] },
      { resource: 'assets', actions: ['read', 'create', 'update', 'depreciate', 'dispose'] }
    ]
  },
  {
    name: 'purchaser',
    description: 'Can manage purchase orders and GRNs',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'suppliers', actions: ['read', 'create', 'update'] },
      { resource: 'purchase_orders', actions: ['read', 'create', 'update', 'approve'] },
      { resource: 'grn', actions: ['read', 'create', 'confirm'] },
      { resource: 'purchase_returns', actions: ['read', 'create', 'confirm'] },
      { resource: 'stock', actions: ['read'] },
      { resource: 'reports', actions: ['read'] }
    ]
  },
  {
    name: 'sales',
    description: 'Can manage quotations, invoices, and deliveries',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'clients', actions: ['read', 'create', 'update'] },
      { resource: 'quotations', actions: ['read', 'create', 'update', 'send', 'convert'] },
      { resource: 'sales_invoices', actions: ['read', 'create', 'update', 'confirm'] },
      { resource: 'delivery_notes', actions: ['read', 'create', 'confirm'] },
      { resource: 'credit_notes', actions: ['read', 'create', 'confirm'] },
      { resource: 'stock', actions: ['read'] },
      { resource: 'reports', actions: ['read'] }
    ]
  },
  {
    name: 'warehouse_manager',
    description: 'Can manage stock, transfers, and audits',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'stock', actions: ['read', 'update'] },
      { resource: 'warehouses', actions: ['read'] },
      { resource: 'stock_transfers', actions: ['read', 'create', 'confirm'] },
      { resource: 'stock_audits', actions: ['read', 'create', 'post'] },
      { resource: 'delivery_notes', actions: ['read', 'confirm'] },
      { resource: 'grn', actions: ['read', 'confirm'] }
    ]
  },
  {
    name: 'viewer',
    description: 'Read-only access to all modules',
    is_system_role: true,
    company_id: null,
    permissions: [
      { resource: '*', actions: ['read'] }
    ]
  }
];

async function seed() {
  await connectDB();

  console.log('Starting role seeding...');

  for (const roleData of SYSTEM_ROLES) {
    try {
      // Check if role exists (by name, system roles only)
      const existing = await Role.findOne({ 
        name: roleData.name, 
        is_system_role: true 
      }).lean();

      if (!existing) {
        await Role.create(roleData);
        console.log(`✅ Seeded system role: ${roleData.name}`);
      } else {
        // Update existing system role with new permissions
        await Role.updateOne(
          { name: roleData.name, is_system_role: true },
          { 
            $set: {
              description: roleData.description,
              permissions: roleData.permissions
            }
          }
        );
        console.log(`✅ Updated system role: ${roleData.name}`);
      }
    } catch (err) {
      console.error(`❌ Error seeding role ${roleData.name}:`, err.message);
    }
  }

  console.log('\nRole seeding complete!');
  
  // List all roles
  const roles = await Role.find({}).lean();
  console.log('\nAll roles in database:');
  roles.forEach(r => {
    console.log(`  - ${r.name} (system: ${r.is_system_role}, company: ${r.company_id || 'global'})`);
  });

  mongoose.disconnect();
  console.log('\nDisconnected from MongoDB');
}

seed().catch(err => {
  console.error('Role seed failed:', err);
  process.exit(1);
});
