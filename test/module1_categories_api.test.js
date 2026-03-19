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

// Helper to build app with category routes
const buildApp = (companyId) => {
  const app = express();
  app.use(express.json());
  const cc = require('../controllers/categoryController');
  // Mock auth using provided companyId
  app.use((req, res, next) => {
    req.user = { id: new mongoose.Types.ObjectId(), company: { _id: companyId || new mongoose.Types.ObjectId() } };
    next();
  });
  app.delete('/api/categories/:id', cc.deleteCategory);
  app.post('/api/categories', cc.createCategory);
  return app;
};

test('Deleting a category that has products returns 409/CATEGORY_IN_USE', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const app = buildApp(companyId);

  const Category = require('../models/Category');
  const Product = require('../models/Product');

  const category = await Category.create({ company: companyId, name: 'HasProducts' });

  await Product.create({ company: companyId, name: 'LinkedProd', sku: 'LP-1', category: category._id, unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000' });

  const res = await request(app).delete(`/api/categories/${category._id}`).expect(409);
  expect(res.body.success).toBe(false);
  expect(res.body.code).toBe('CATEGORY_IN_USE');
});
