const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
});

const Purchase = require('../models/Purchase');
const Supplier = require('../models/Supplier');
const purchaseController = require('../controllers/purchaseController');
const { authorize } = require('../middleware/auth');

function buildAppWithUser(role, companyId, userId) {
  const app = express();
  app.use(express.json());

  // inject mock user and company
  app.use((req, res, next) => {
    req.user = { _id: userId || new mongoose.Types.ObjectId(), id: userId || new mongoose.Types.ObjectId(), role, company: { _id: companyId } };
    next();
  });

  // mount a single route with authorization as used in production
  app.delete('/api/purchases/:id', authorize('admin'), purchaseController.deletePurchase);

  // error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ message: err && err.message });
  });

  return app;
}

test('DELETE /api/purchases/:id is forbidden for non-admin and soft-deletes for admin', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const supplier = await Supplier.create({ company: companyId, name: 'S1' });

  const purchase = await Purchase.create({ company: companyId, supplier: supplier._id, items: [], createdBy: new mongoose.Types.ObjectId() });

  // non-admin user should receive 403
  const appUser = buildAppWithUser('user', companyId, new mongoose.Types.ObjectId());
  const r1 = await request(appUser).delete(`/api/purchases/${purchase._id}`);
  expect(r1.status).toBe(403);

  // admin should soft-delete
  const appAdmin = buildAppWithUser('admin', companyId, new mongoose.Types.ObjectId());
  const r2 = await request(appAdmin).delete(`/api/purchases/${purchase._id}`);
  expect(r2.status).toBe(200);
  expect(r2.body.success).toBe(true);

  const reloaded = await Purchase.findById(purchase._id).lean();
  expect(reloaded).toBeDefined();
  // purchase should be marked cancelled and not removed
  expect(reloaded.status).toBe('cancelled');
  // if isActive present, it should be false
  if (typeof reloaded.isActive !== 'undefined') expect(reloaded.isActive).toBe(false);
});
