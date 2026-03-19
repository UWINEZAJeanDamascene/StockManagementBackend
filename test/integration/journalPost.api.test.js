const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const JournalEntry = require('../../models/JournalEntry');

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

test('PUT /api/journal-entries/:id/post (API) posts a draft entry successfully', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());

  const journalController = require('../../controllers/journalController');

  // Route to create draft entries (uses controller)
  app.post('/api/journal-entries', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.createJournalEntry(req, res, next);
  });

  // Route to post entries
  app.put('/api/journal-entries/:id/post', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.postJournalEntry(req, res, next);
  });

  // Create draft via API
  const createResp = await request(app)
    .post('/api/journal-entries')
    .send({
      date: new Date().toISOString(),
      description: 'Draft for posting',
      lines: [
        { accountCode: '1300', debit: 100, credit: 0, description: 'Debit' },
        { accountCode: '2100', debit: 0, credit: 100, description: 'Credit' }
      ]
    })
    .expect(201);

  expect(createResp.body.success).toBe(true);
  const draft = createResp.body.data;
  expect(draft.status).toBe('draft');

  // Post the draft
  const postResp = await request(app)
    .put(`/api/journal-entries/${draft._id}/post`)
    .expect(200);

  expect(postResp.body.success).toBe(true);
  expect(postResp.body.data.status).toBe('posted');

  // Verify postedBy is set
  const reloaded = await JournalEntry.findById(draft._id).lean();
  expect(reloaded.status).toBe('posted');
  expect(reloaded.postedBy).toBeDefined();
});

test('Posting an already posted entry returns 400', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());
  const journalController = require('../../controllers/journalController');

  app.post('/api/journal-entries', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.createJournalEntry(req, res, next);
  });
  app.put('/api/journal-entries/:id/post', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.postJournalEntry(req, res, next);
  });

  const createResp = await request(app)
    .post('/api/journal-entries')
    .send({
      date: new Date().toISOString(),
      description: 'Already posted test',
      lines: [
        { accountCode: '1300', debit: 200, credit: 0, description: 'Debit' },
        { accountCode: '2100', debit: 0, credit: 200, description: 'Credit' }
      ]
    })
    .expect(201);

  const draft = createResp.body.data;

  // First post should succeed
  await request(app).put(`/api/journal-entries/${draft._id}/post`).expect(200);

  // Second post should fail with 400
  const second = await request(app).put(`/api/journal-entries/${draft._id}/post`).expect(400);
  expect(second.body.success).toBe(false);
  expect(second.body.message).toMatch(/already posted/i);
});

test('Posting fails when period is closed', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());
  const journalController = require('../../controllers/journalController');

  app.post('/api/journal-entries', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.createJournalEntry(req, res, next);
  });
  app.put('/api/journal-entries/:id/post', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.postJournalEntry(req, res, next);
  });

  // Create a closed period that includes the date
  const Period = require('../../models/Period');
  await Period.create({ company: companyId, name: 'Closed', startDate: new Date('2020-01-01'), endDate: new Date('2020-01-31'), status: 'closed' });

  // Create draft with date in closed period
  const createResp = await request(app)
    .post('/api/journal-entries')
    .send({
      date: new Date('2020-01-15').toISOString(),
      description: 'Draft in closed period',
      lines: [
        { accountCode: '1300', debit: 70, credit: 0, description: 'Debit' },
        { accountCode: '2100', debit: 0, credit: 70, description: 'Credit' }
      ]
    })
    .expect(201);

  const draft = createResp.body.data;

  const postResp = await request(app).put(`/api/journal-entries/${draft._id}/post`).expect(400);
  expect(postResp.body.success).toBe(false);
  expect(postResp.body.message).toMatch(/period/i);
});

test('Cannot post a voided entry', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Create a voided draft directly (balanced)
  const entry = await JournalEntry.create({
    company: companyId,
    entryNumber: 'JE-VOID-0001',
    date: new Date(),
    description: 'Voided draft',
    lines: [
      { accountCode: '1300', accountName: 'Account 1300', debit: 30, credit: 0 },
      { accountCode: '2100', accountName: 'Account 2100', debit: 0, credit: 30 }
    ],
    totalDebit: 30,
    totalCredit: 30,
    status: 'voided',
    createdBy: userId
  });

  const app = express();
  app.use(express.json());
  const journalController = require('../../controllers/journalController');
  app.put('/api/journal-entries/:id/post', (req, res, next) => {
    req.user = { _id: userId, company: { _id: companyId } };
    journalController.postJournalEntry(req, res, next);
  });

  const r = await request(app).put(`/api/journal-entries/${entry._id}/post`).expect(400);
  expect(r.body.success).toBe(false);
  expect(r.body.message).toMatch(/voided/i);
});
