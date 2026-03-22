/**
 * Account lockout and login timing — UserService.login
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const UserService = require('../../../services/UserService');
const User = require('../../../models/User');
const Company = require('../../../models/Company');

jest.mock('../../../services/notificationHelper', () => ({
  notifyUserCreated: jest.fn().mockResolvedValue(true),
  notifyPasswordChanged: jest.fn().mockResolvedValue(true),
  notifyAccountLocked: jest.fn().mockResolvedValue(true),
}));

let mongoServer;
let testCompany;
let testUser;

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
    name: 'Lockout Test Co',
    email: 'lockout@company.com',
    code: 'LK001',
    isActive: true,
    approvalStatus: 'approved',
  });

  testUser = await User.create({
    name: 'Lockout User',
    email: 'lockme@test.com',
    password: 'correctHorse1',
    company: testCompany._id,
    role: 'admin',
    isActive: true,
    failed_login_attempts: 0,
    locked_until: null,
  });
});

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe('Account Lockout', () => {
  it('failed_login_attempts increments on wrong password', async () => {
    expect(testUser.failed_login_attempts).toBe(0);

    try {
      await UserService.login('lockme@test.com', 'wrongPassword1', testCompany._id);
    } catch (e) {
      expect(e.code).toBe('INVALID_CREDENTIALS');
    }

    const updated = await User.findById(testUser._id);
    expect(updated.failed_login_attempts).toBe(1);
  });

  it('account locks after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await UserService.login('lockme@test.com', 'wrongPassword1', testCompany._id);
      } catch (e) {
        expect(['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED']).toContain(e.code);
      }
    }

    const locked = await User.findById(testUser._id);
    expect(locked.failed_login_attempts).toBeGreaterThanOrEqual(5);
    expect(locked.locked_until).toBeDefined();
    expect(locked.locked_until.getTime()).toBeGreaterThan(Date.now());
  });

  it('locked_until is set to 30 minutes from now on lockout', async () => {
    const before = Date.now();

    for (let i = 0; i < 5; i++) {
      try {
        await UserService.login('lockme@test.com', 'badPass999', testCompany._id);
      } catch (e) {
        /* expected */
      }
    }

    const after = Date.now();
    const locked = await User.findById(testUser._id);
    const expectedMin = before + 30 * 60 * 1000 - 3000;
    const expectedMax = after + 30 * 60 * 1000 + 3000;

    expect(locked.locked_until.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(locked.locked_until.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('throws ACCOUNT_LOCKED when locked_until is in the future', async () => {
    const u = await User.findById(testUser._id);
    u.locked_until = new Date(Date.now() + 45 * 60 * 1000);
    await u.save();

    await expect(
      UserService.login('lockme@test.com', 'correctHorse1', testCompany._id),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('failed_login_attempts resets to 0 on successful login', async () => {
    const u = await User.findById(testUser._id);
    u.failed_login_attempts = 4;
    await u.save();

    await UserService.login('lockme@test.com', 'correctHorse1', testCompany._id);

    const after = await User.findById(testUser._id);
    expect(after.failed_login_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
  });

  it('response time is consistent for wrong email and wrong password', async () => {
    const samples = 10;
    const wrongEmailMs = [];
    const wrongPasswordMs = [];

    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      try {
        await UserService.login('nobody-here@test.com', 'anyPassword9', testCompany._id);
      } catch (e) {
        expect(e.code).toBe('INVALID_CREDENTIALS');
      }
      wrongEmailMs.push(Date.now() - t0);

      await User.updateOne(
        { _id: testUser._id },
        { $set: { failed_login_attempts: 0, locked_until: null } },
      );

      const t1 = Date.now();
      try {
        await UserService.login('lockme@test.com', 'wrongPassword9', testCompany._id);
      } catch (e) {
        expect(e.code).toBe('INVALID_CREDENTIALS');
      }
      wrongPasswordMs.push(Date.now() - t1);
    }

    const mEmail = median(wrongEmailMs);
    const mPassword = median(wrongPasswordMs);
    const diff = Math.abs(mEmail - mPassword);

    // Wrong password includes a DB write; allow slack while still catching a fast-path-only unknown user.
    expect(diff).toBeLessThan(600);
  });
});
