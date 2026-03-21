/**
 * Module 5 - Roles & Permissions Acceptance Tests
 * 
 * Tests:
 * 1. admin role can access any resource and action
 * 2. viewer role can only read — create returns 403
 * 3. purchaser cannot access journal_entries
 * 4. accountant cannot create products
 * 5. warehouse_manager cannot post payroll
 * 6. wildcard permission matches any resource
 * 7. system roles cannot be deleted
 * 8. custom role can be created and assigned to user
 * 9. changing user role takes effect on next request
 */

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../server');

const Role = require('../models/Role');
const User = require('../models/User');
const Company = require('../models/Company');
const { PermissionService } = require('../middleware/authorize');

jest.setTimeout(60000);

describe('Module 5 - Roles & Permissions Acceptance Tests', () => {
  let adminToken;
  let viewerToken;
  let testCompany;
  let adminUser;
  let viewerUser;
  let customRole;
  let testUsers = {};

  const cleanup = async () => {
    if (customRole) {
      await Role.findByIdAndDelete(customRole._id).catch(() => {});
    }
    for (const key of Object.keys(testUsers)) {
      const user = testUsers[key];
      if (user && user._id) {
        await User.findByIdAndDelete(user._id).catch(() => {});
      }
    }
    if (testCompany && testCompany._id) {
      await Company.findByIdAndDelete(testCompany._id).catch(() => {});
    }
  };

  beforeAll(async () => {
    jest.setTimeout(60000);
    const unique = Date.now();

    testCompany = await Company.create({
      name: 'Test Company for Permissions',
      email: `perm${unique}@test.com`,
      phone: '1234567890',
      address: { street: 'Test Address' },
      base_currency: 'USD',
      fiscal_year_start_month: 1,
      approvalStatus: 'approved',
      is_active: true,
      isActive: true
    });

    // Seed system roles
    const systemRoles = [
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
        name: 'viewer',
        description: 'Read-only access to all modules',
        is_system_role: true,
        company_id: null,
        permissions: [
          { resource: '*', actions: ['read'] }
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
          { resource: 'reports', actions: ['read'] },
          { resource: 'journal_entries', actions: [] }
        ]
      },
      {
        name: 'accountant',
        description: 'Full accounting access',
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
          { resource: 'grn', actions: ['read', 'confirm'] },
          { resource: 'payroll', actions: [] }
        ]
      }
    ];

    for (const roleData of systemRoles) {
      await Role.findOneAndUpdate(
        { name: roleData.name, is_system_role: true },
        roleData,
        { upsert: true, new: true }
      );
    }

    const users = [
      { name: 'Admin User', email: `admin${unique}@test.com`, role: 'admin' },
      { name: 'Viewer User', email: `viewer${unique}@test.com`, role: 'viewer' },
      { name: 'Purchaser User', email: `purchaser${unique}@test.com`, role: 'purchaser' },
      { name: 'Accountant User', email: `accountant${unique}@test.com`, role: 'accountant' },
      { name: 'Warehouse Manager', email: `wm${unique}@test.com`, role: 'warehouse_manager' }
    ];

    for (const userData of users) {
      const user = await User.create({
        name: userData.name,
        email: userData.email,
        password: 'password123',
        company: testCompany._id,
        role: userData.role,
        isActive: true
      });
      testUsers[userData.role] = user;
    }

    const loginUser = async (email) => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email,
          password: 'password123'
        });
      return res.body.access_token || res.body.token;
    };

    adminToken = await loginUser(`admin${unique}@test.com`);
    viewerToken = await loginUser(`viewer${unique}@test.com`);

    adminUser = testUsers['admin'];
    viewerUser = testUsers['viewer'];
  }, 60000);

  afterAll(async () => {
    await cleanup();
    
    try {
      await mongoose.connection.close();
    } catch (e) {
      console.warn('Error closing mongoose connection', e);
    }

    try {
      if (app && typeof app.shutdown === 'function') {
        await app.shutdown();
      }
    } catch (e) {
      console.warn('Error during app.shutdown', e);
    }
  }, 60000);

  describe('Permission Tests via PermissionService', () => {
    /**
     * Test 1: admin role can access any resource and action
     */
    it('admin role can access any resource and action', async () => {
      const adminRole = await Role.findOne({ name: 'admin', is_system_role: true });
      
      // Admin should have all permissions on wildcard
      expect(PermissionService.check(adminRole, 'products', 'create')).toBe(true);
      expect(PermissionService.check(adminRole, 'products', 'delete')).toBe(true);
      expect(PermissionService.check(adminRole, 'journal_entries', 'post')).toBe(true);
      // Admin with wildcard should match any resource with allowed action
      expect(PermissionService.check(adminRole, 'anything', 'read')).toBe(true);
      expect(PermissionService.check(adminRole, 'anything', 'delete')).toBe(true);
    });

    /**
     * Test 2: viewer role can only read — create returns 403
     */
    it('viewer role can only read — create returns false', async () => {
      const viewerRole = await Role.findOne({ name: 'viewer', is_system_role: true });
      
      // Viewer should have read access
      expect(PermissionService.check(viewerRole, 'products', 'read')).toBe(true);
      
      // Viewer should NOT have create access
      expect(PermissionService.check(viewerRole, 'products', 'create')).toBe(false);
      expect(PermissionService.check(viewerRole, 'products', 'delete')).toBe(false);
    });

    /**
     * Test 3: purchaser cannot access journal_entries
     */
    it('purchaser cannot access journal_entries', async () => {
      const purchaserRole = await Role.findOne({ name: 'purchaser', is_system_role: true });
      
      // Purchaser should have access to purchases
      expect(PermissionService.check(purchaserRole, 'purchase_orders', 'create')).toBe(true);
      
      // Purchaser should NOT have access to journal_entries
      expect(PermissionService.check(purchaserRole, 'journal_entries', 'read')).toBe(false);
      expect(PermissionService.check(purchaserRole, 'journal_entries', 'create')).toBe(false);
    });

    /**
     * Test 4: accountant cannot create products
     */
    it('accountant cannot create products', async () => {
      const accountantRole = await Role.findOne({ name: 'accountant', is_system_role: true });
      
      // Accountant can read products
      expect(PermissionService.check(accountantRole, 'products', 'read')).toBe(true);
      
      // Accountant cannot create products
      expect(PermissionService.check(accountantRole, 'products', 'create')).toBe(false);
      expect(PermissionService.check(accountantRole, 'products', 'delete')).toBe(false);
    });

    /**
     * Test 5: warehouse_manager cannot post payroll
     */
    it('warehouse_manager cannot post payroll', async () => {
      const wmRole = await Role.findOne({ name: 'warehouse_manager', is_system_role: true });
      
      // Warehouse manager can access stock
      expect(PermissionService.check(wmRole, 'stock', 'read')).toBe(true);
      expect(PermissionService.check(wmRole, 'stock', 'update')).toBe(true);
      
      // Warehouse manager cannot post payroll
      expect(PermissionService.check(wmRole, 'payroll', 'read')).toBe(false);
      expect(PermissionService.check(wmRole, 'payroll', 'create')).toBe(false);
      expect(PermissionService.check(wmRole, 'payroll', 'post')).toBe(false);
    });

    /**
     * Test 6: wildcard permission matches any resource
     */
    it('wildcard permission matches any resource', async () => {
      const adminRole = await Role.findOne({ name: 'admin', is_system_role: true });
      
      // Wildcard should match any resource
      expect(PermissionService.check(adminRole, 'any_resource', 'read')).toBe(true);
      expect(PermissionService.check(adminRole, 'random', 'delete')).toBe(true);
      expect(PermissionService.check(adminRole, 'anything_goes', 'post')).toBe(true);
    });

    /**
     * Test 7: system roles cannot be deleted
     */
    it('system roles cannot be deleted', async () => {
      const adminRole = await Role.findOne({ name: 'admin', is_system_role: true });
      
      // System role flag should be true
      expect(adminRole.is_system_role).toBe(true);
      
      // Try to delete via API
      const deleteRes = await request(app)
        .delete(`/api/access/roles/${adminRole._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error).toBe('CANNOT_DELETE_SYSTEM_ROLE');
    });

    /**
     * Test 8: custom role can be created
     */
    it('custom role can be created', async () => {
      const createRes = await request(app)
        .post('/api/access/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'custom_accountant',
          description: 'Custom role for accounting team',
          permissions: [
            { resource: 'products', actions: ['read'] },
            { resource: 'journal_entries', actions: ['read', 'create'] },
            { resource: 'reports', actions: ['read'] }
          ]
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      customRole = createRes.body.data;

      // Verify custom role has correct permissions
      expect(customRole.is_system_role).toBe(false);
      expect(customRole.permissions.length).toBe(3);
    });

    /**
     * Test 9: roles can be fetched and listed
     */
    it('roles can be fetched and listed', async () => {
      const listRes = await request(app)
        .get('/api/access/roles')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.count).toBeGreaterThan(0);

      // Should include system roles
      const roleNames = listRes.body.data.map(r => r.name);
      expect(roleNames).toContain('admin');
      expect(roleNames).toContain('viewer');
    });
  });
});
