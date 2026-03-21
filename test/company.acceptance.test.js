const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const Company = require('../models/Company');
const User = require('../models/User');

let mongoServer;
let companyId, userId;
let platformAdminUserId;
let companyController;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });
});

beforeEach(async () => {
  // Create company
  const company = await Company.create({
    name: 'Test Company',
    code: 'TC001',
    base_currency: 'USD',
    fiscal_year_start_month: 1,
    setup_completed: false,
    setup_steps_completed: {
      company_profile: false,
      chart_of_accounts: false,
      opening_balances: false,
      first_user: false,
      first_period: false
    }
  });
  companyId = company._id;

  // Create regular user belonging to the company
  const user = await User.create({
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    password: 'password123',
    company: companyId,
    role: 'admin'
  });
  userId = user._id;

  // Create platform admin user
  const platformAdmin = await User.create({
    name: 'Platform Admin',
    email: `admin-${Date.now()}@example.com`,
    password: 'password123',
    company: null,
    role: 'platform_admin'
  });
  platformAdminUserId = platformAdmin._id;

  // Load controller
  companyController = require('../controllers/companyController');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  // Clear all collections after each test
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
});

// Helper to create express app with Company routes using mock auth
function createApp(authUser) {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware
  app.use((req, res, next) => {
    const defaultUser = { 
      id: userId, 
      _id: userId, 
      company: companyId,
      role: 'admin'
    };
    const user = authUser || defaultUser;
    // Ensure company is an ObjectId for comparison
    if (user.company && typeof user.company === 'object' && user.company._id) {
      user.company = user.company._id;
    }
    req.user = user;
    next();
  });

  // Mount routes
  app.post('/api/companies', (req, res, next) => companyController.createCompany(req, res, next));
  app.get('/api/companies', (req, res, next) => companyController.getAllCompanies(req, res, next));
  app.get('/api/companies/:id', (req, res, next) => companyController.getCompany(req, res, next));
  app.put('/api/companies/:id', (req, res, next) => companyController.updateCompany(req, res, next));
  app.post('/api/companies/:id/logo', (req, res, next) => companyController.uploadLogo(req, res, next));
  app.get('/api/companies/:id/setup-status', (req, res, next) => companyController.getSetupStatus(req, res, next));
  app.post('/api/companies/:id/setup/:step', (req, res, next) => companyController.markSetupStepComplete(req, res, next));
  app.delete('/api/companies/:id', (req, res, next) => companyController.deleteCompany(req, res, next));

  // Simple error handler so tests receive error messages
  app.use((err, req, res, next) => {
    console.error('Test error handler caught:', err && (err.stack || err));
    const status = err && (err.statusCode || err.status) ? (err.statusCode || err.status) : 500;
    const message = err && (err.message || err.toString()) ? (err.message || err.toString()) : 'Internal Server Error';
    res.status(status).json({ success: false, error: message });
  });

  return app;
}

describe('Company Profile API', () => {
  
  describe('POST /api/companies - Create Company', () => {
    it('should create company as platform admin', async () => {
      const app = createApp({ 
        _id: platformAdminUserId, 
        company: null,
        role: 'platform_admin' 
      });
      
      const res = await request(app)
        .post('/api/companies')
        .send({
          name: 'New Company',
          code: 'NC001',
          base_currency: 'EUR'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Company');
      expect(res.body.data.code).toBe('NC001');
    });

    it('should reject non-platform admin from creating company', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post('/api/companies')
        .send({
          name: 'New Company',
          code: 'NC002',
          base_currency: 'EUR'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('should reject duplicate company code', async () => {
      // First create a company
      await Company.create({
        name: 'Existing Company',
        code: 'EXIST01',
        base_currency: 'USD'
      });

      const app = createApp({ 
        _id: platformAdminUserId, 
        company: null,
        role: 'platform_admin' 
      });
      
      const res = await request(app)
        .post('/api/companies')
        .send({
          name: 'Duplicate Company',
          code: 'EXIST01',
          base_currency: 'EUR'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('COMPANY_CODE_TAKEN');
    });

    it('should reject invalid company code format', async () => {
      const app = createApp({ 
        _id: platformAdminUserId, 
        company: null,
        role: 'platform_admin' 
      });
      
      const res = await request(app)
        .post('/api/companies')
        .send({
          name: 'Test Company',
          code: 'INV@LD!',
          base_currency: 'USD'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('INVALID_COMPANY_CODE');
    });
  });

  describe('GET /api/companies/:id - Get Company', () => {
    it('should return company by id', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .get(`/api/companies/${companyId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Company');
    });

    it('should return 404 for non-existent company', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .get(`/api/companies/${fakeId}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('COMPANY_NOT_FOUND');
    });
  });

  describe('GET /api/companies - List Companies', () => {
    it('should list companies as platform admin', async () => {
      // Create additional companies
      await Company.create([
        { name: 'Company A', code: 'COMPA', base_currency: 'USD' },
        { name: 'Company B', code: 'COMPB', base_currency: 'EUR' }
      ]);

      const app = createApp({ 
        _id: platformAdminUserId, 
        company: null,
        role: 'platform_admin' 
      });
      
      const res = await request(app)
        .get('/api/companies');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should reject non-platform admin from listing all companies', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .get('/api/companies');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });
  });

  describe('PUT /api/companies/:id - Update Company', () => {
    it('should update company name', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .put(`/api/companies/${companyId}`)
        .send({ name: 'Updated Company Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Company Name');
    });

    it('should prevent updating other company', async () => {
      const otherCompany = await Company.create({
        name: 'Other Company',
        code: 'OTHER01',
        base_currency: 'USD'
      });

      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .put(`/api/companies/${otherCompany._id}`)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('should prevent currency change when transactions exist', async () => {
      // Create a mock journal entry to simulate existing transactions
      const JournalEntry = require('../models/JournalEntry');
      await JournalEntry.create({
        company: companyId,
        date: new Date(),
        entryNumber: 'JE-001',
        description: 'Test entry',
        debitTotal: 100,
        creditTotal: 100,
        status: 'posted',
        lines: []
      });

      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .put(`/api/companies/${companyId}`)
        .send({ base_currency: 'EUR' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('BASE_CURRENCY_LOCKED');
    });
  });

  describe('POST /api/companies/:id/logo - Upload Logo', () => {
    it('should upload logo with valid URL', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post(`/api/companies/${companyId}/logo`)
        .send({ logo_url: 'https://example.com/logo.png' });

      // Log error for debugging
      if (res.status !== 200) {
        console.log('Logo upload error:', res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logo_url).toBe('https://example.com/logo.png');
    });

    it('should reject logo upload without URL', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post(`/api/companies/${companyId}/logo`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('LOGO_URL_REQUIRED');
    });
  });

  describe('GET /api/companies/:id/setup-status - Get Setup Status', () => {
    it('should return setup status', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .get(`/api/companies/${companyId}/setup-status`);

      // Log error for debugging
      if (res.status !== 200) {
        console.log('Setup status error:', res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('setup_completed');
      expect(res.body.data).toHaveProperty('setup_steps_completed');
    });
  });

  describe('POST /api/companies/:id/setup/:step - Mark Setup Step Complete', () => {
    it('should mark setup step as complete', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post(`/api/companies/${companyId}/setup/company_profile`);

      // Log error for debugging
      if (res.status !== 200) {
        console.log('Mark step complete error:', res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.setup_steps_completed.company_profile).toBe(true);
    });

    it('should set setup_completed when all steps are done', async () => {
      // First mark all steps as complete
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          'setup_steps_completed.company_profile': true,
          'setup_steps_completed.chart_of_accounts': true,
          'setup_steps_completed.opening_balances': true,
          'setup_steps_completed.first_user': true
        }
      });

      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post(`/api/companies/${companyId}/setup/first_period`);

      // Log error for debugging
      if (res.status !== 200) {
        console.log('All steps complete error:', res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.setup_completed).toBe(true);
    });

    it('should reject invalid setup step', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .post(`/api/companies/${companyId}/setup/invalid_step`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('INVALID_SETUP_STEP');
    });
  });

  describe('DELETE /api/companies/:id - Delete Company', () => {
    it('should delete company as platform admin', async () => {
      const companyToDelete = await Company.create({
        name: 'To Delete',
        code: 'DEL01',
        base_currency: 'USD'
      });

      const app = createApp({ 
        _id: platformAdminUserId, 
        company: null,
        role: 'platform_admin' 
      });
      
      const res = await request(app)
        .delete(`/api/companies/${companyToDelete._id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject non-platform admin from deleting company', async () => {
      const app = createApp({
        _id: userId,
        company: companyId,
        role: 'admin'
      });
      
      const res = await request(app)
        .delete(`/api/companies/${companyId}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });
  });
});
