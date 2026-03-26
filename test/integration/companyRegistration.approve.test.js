/**
 * Integration: public company registration → platform admin approval.
 * Run: cd Stock_tenancy_system && npm test -- test/integration/companyRegistration.approve.test.js
 */
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Company = require('../../models/Company');
const User = require('../../models/User');
const companyController = require('../../controllers/companyController');

let mongoServer;
let platformAdminId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }

  const admin = await User.create({
    name: 'Platform Admin',
    email: 'platform-admin@example.com',
    password: 'TestPass123!',
    role: 'platform_admin'
  });
  platformAdminId = admin._id;
});

function buildApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/companies/register', (req, res, next) =>
    companyController.registerPublic(req, res, next)
  );

  app.use((req, res, next) => {
    if (req.path === '/api/companies/register' && req.method === 'POST') {
      return next();
    }
    req.user = {
      _id: platformAdminId,
      role: 'platform_admin'
    };
    next();
  });

  app.get('/api/companies/pending', (req, res, next) =>
    companyController.getPendingCompanies(req, res, next)
  );
  app.get('/api/companies/rejected', (req, res, next) =>
    companyController.getRejectedCompanies(req, res, next)
  );
  app.put('/api/companies/:id/approve', (req, res, next) =>
    companyController.approveCompany(req, res, next)
  );
  app.put('/api/companies/:id/reject', (req, res, next) =>
    companyController.rejectCompany(req, res, next)
  );

  return app;
}

describe('Company registration and approval', () => {
  const app = buildApp();

  it('registers a company as pending, lists it, then approves it', async () => {
    const suffix = Date.now();
    const registerBody = {
      company: {
        name: `Test Co ${suffix}`,
        email: `biz-${suffix}@example.com`,
        tin: 'TIN123',
        phone: '+250700000000'
      },
      admin: {
        name: 'Admin User',
        email: `admin-${suffix}@example.com`,
        password: 'SecurePass123!'
      }
    };

    const regRes = await request(app)
      .post('/api/companies/register')
      .send(registerBody)
      .expect(201);

    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.company).toBeDefined();
    expect(regRes.body.data.company.status).toBe('pending');
    const companyId = regRes.body.data.company._id;

    const companyDoc = await Company.findById(companyId);
    expect(companyDoc).toBeTruthy();
    expect(companyDoc.approvalStatus).toBe('pending');
    expect(companyDoc.isActive).toBe(false);

    const pendingRes = await request(app).get('/api/companies/pending').expect(200);
    expect(pendingRes.body.success).toBe(true);
    expect(Array.isArray(pendingRes.body.data)).toBe(true);
    expect(pendingRes.body.data.length).toBe(1);
    expect(pendingRes.body.data[0]._id).toBe(companyId.toString());

    const approveRes = await request(app)
      .put(`/api/companies/${companyId}/approve`)
      .expect(200);

    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.data.approvalStatus).toBe('approved');

    const after = await Company.findById(companyId);
    expect(after.approvalStatus).toBe('approved');
    expect(after.isActive).toBe(true);

    const pendingAfter = await request(app).get('/api/companies/pending').expect(200);
    expect(pendingAfter.body.data.length).toBe(0);
  });

  it('rejects duplicate registration with same company business email', async () => {
    const email = `same-biz-${Date.now()}@example.com`;
    const body = {
      company: { name: 'A', email, tin: '', phone: '' },
      admin: { name: 'A', email: `a1-${Date.now()}@example.com`, password: 'SecurePass123!' }
    };
    await request(app).post('/api/companies/register').send(body).expect(201);
    const dup = await request(app)
      .post('/api/companies/register')
      .send({
        company: { name: 'B', email, tin: '', phone: '' },
        admin: { name: 'B', email: `b2-${Date.now()}@example.com`, password: 'SecurePass123!' }
      })
      .expect(409);
    expect(dup.body.success).toBe(false);
  });
});
