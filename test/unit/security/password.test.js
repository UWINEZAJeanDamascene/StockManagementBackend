/**
 * Password hashing (bcrypt cost 12) and API leakage
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const passwordUtils = require('../../../utils/passwordUtils');
const User = require('../../../models/User');
const Company = require('../../../models/Company');
const UserService = require('../../../services/UserService');

jest.mock('../../../services/notificationHelper', () => ({
  notifyUserCreated: jest.fn().mockResolvedValue(true),
  notifyPasswordChanged: jest.fn().mockResolvedValue(true),
  notifyAccountLocked: jest.fn().mockResolvedValue(true),
}));

let mongoServer;
let testCompany;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Company.deleteMany({});

  testCompany = await Company.create({
    name: 'Password Test Co',
    email: 'pw@company.com',
    code: 'PW001',
    isActive: true,
    approvalStatus: 'approved',
  });
});

/** bcryptjs uses $2a$; some implementations use $2b$ — cost is the third segment. */
function assertBcryptCost12(hash) {
  expect(hash).toMatch(/^\$2[aby]\$12\$/);
}

describe('Password Security', () => {
  it('password is hashed with bcrypt work factor 12', async () => {
    const user = await User.create({
      name: 'Hash User',
      email: 'hash@test.com',
      password: 'mySecretPass1',
      company: testCompany._id,
      role: 'viewer',
      isActive: true,
    });

    const raw = await User.findById(user._id).select('+password');
    expect(raw.password).not.toBe('mySecretPass1');
    assertBcryptCost12(raw.password);
  });

  it('password_hash field never returned in API responses', async () => {
    const registered = await UserService.register({
      email: 'api-leak@test.com',
      password: 'password123',
      name: 'API User',
      companyId: testCompany._id,
    });

    expect(registered.password).toBeUndefined();
    expect(registered.password_hash).toBeUndefined();

    const doc = await User.findOne({ email: 'api-leak@test.com' });
    const json = doc.toJSON();
    expect(json.password).toBeUndefined();
    expect(json.password_hash).toBeUndefined();
  });

  it('compare returns true for correct password', async () => {
    const user = await User.create({
      name: 'Compare Ok',
      email: 'compare-ok@test.com',
      password: 'correctHorse1',
      company: testCompany._id,
      role: 'viewer',
      isActive: true,
    });

    const withSecret = await User.findById(user._id).select('+password');
    await expect(withSecret.comparePassword('correctHorse1')).resolves.toBe(true);
    await expect(passwordUtils.compare('correctHorse1', withSecret.password)).resolves.toBe(true);
  });

  it('compare returns false for wrong password', async () => {
    const user = await User.create({
      name: 'Compare Bad',
      email: 'compare-bad@test.com',
      password: 'correctHorse1',
      company: testCompany._id,
      role: 'viewer',
      isActive: true,
    });

    const withSecret = await User.findById(user._id).select('+password');
    await expect(withSecret.comparePassword('wrongPassword1')).resolves.toBe(false);
    await expect(passwordUtils.compare('wrongPassword1', withSecret.password)).resolves.toBe(false);
  });

  it('bcrypt rounds equals 12', async () => {
    const hash = await passwordUtils.hash('testPassword1');
    expect(hash.startsWith('$2b$12$') || hash.startsWith('$2a$12$')).toBe(true);
    expect(passwordUtils.BCRYPT_ROUNDS).toBe(12);
  });
});
