/**
 * TokenService — JWT pair, rotation, hashed refresh storage, revocation
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const TokenService = require('../../../services/tokenService');
const User = require('../../../models/User');
const Company = require('../../../models/Company');

jest.mock('../../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue(true),
  registerAccessToken: jest.fn().mockResolvedValue(true),
  deleteAllSessions: jest.fn().mockResolvedValue(true),
}));

const SessionService = require('../../../services/sessionService');

let mongoServer;
let testCompany;
let testUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  process.env.JWT_EXPIRE = '15m';
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await User.deleteMany({});
  await Company.deleteMany({});

  testCompany = await Company.create({
    name: 'JWT Co',
    email: 'jwt@company.com',
    code: 'JW001',
    isActive: true,
    approvalStatus: 'approved',
  });

  testUser = await User.create({
    name: 'JWT User',
    email: 'jwtuser@test.com',
    password: 'password123',
    company: testCompany._id,
    role: 'admin',
    isActive: true,
  });
});

describe('TokenService', () => {
  const memberships = () => [
    { companyId: testCompany._id.toString(), role: 'admin' },
  ];

  it('generateTokenPair returns access_token and refresh_token', async () => {
    const pair = await TokenService.generateTokenPair(testUser._id.toString(), memberships());

    expect(pair.access_token).toBeDefined();
    expect(pair.refresh_token).toBeDefined();
    expect(typeof pair.access_token).toBe('string');
    expect(typeof pair.refresh_token).toBe('string');
  });

  it('access token expires after 15 minutes', async () => {
    const pair = await TokenService.generateTokenPair(testUser._id.toString(), memberships());
    const decoded = jwt.decode(pair.access_token);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    const ttlSec = decoded.exp - decoded.iat;
    expect(ttlSec).toBeGreaterThanOrEqual(14 * 60);
    expect(ttlSec).toBeLessThanOrEqual(16 * 60);
  });

  it('refresh token rotates — old token is revoked after use', async () => {
    const p1 = await TokenService.generateTokenPair(testUser._id.toString(), memberships());
    const p2 = await TokenService.refreshWithRotation(p1.refresh_token);

    expect(p2.access_token).toBeDefined();
    expect(p2.refresh_token).toBeDefined();
    expect(p2.refresh_token).not.toBe(p1.refresh_token);

    await expect(TokenService.refreshWithRotation(p1.refresh_token)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('using a revoked refresh token revokes ALL user tokens', async () => {
    const p1 = await TokenService.generateTokenPair(testUser._id.toString(), memberships());
    const p2 = await TokenService.refreshWithRotation(p1.refresh_token);

    await expect(TokenService.refreshWithRotation(p1.refresh_token)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });

    expect(SessionService.deleteAllSessions).toHaveBeenCalledWith(testUser._id.toString());

    await expect(TokenService.refreshWithRotation(p2.refresh_token)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('expired refresh token throws REFRESH_TOKEN_EXPIRED', async () => {
    const expired = jwt.sign(
      { userId: testUser._id.toString(), type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' },
    );

    await expect(TokenService.refreshWithRotation(expired)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
    });
  });

  it('tampered refresh token throws INVALID_REFRESH_TOKEN', async () => {
    const p = await TokenService.generateTokenPair(testUser._id.toString(), memberships());
    const tampered = p.refresh_token.slice(0, -8) + 'deadbeef';

    await expect(TokenService.refreshWithRotation(tampered)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('raw refresh token is never stored — only SHA-256 hash', async () => {
    const p = await TokenService.generateTokenPair(testUser._id.toString(), memberships());
    const fromDb = await User.findById(testUser._id).select('+refresh_token +refresh_token_hash');

    expect(fromDb.refresh_token).toBeNull();
    expect(fromDb.refresh_token_hash).toBe(TokenService.sha256Refresh(p.refresh_token));
    expect(fromDb.refresh_token_hash).not.toBe(p.refresh_token);
  });

  it('revokeAllForUser revokes all tokens and deactivates all sessions', async () => {
    await TokenService.generateTokenPair(testUser._id.toString(), memberships());

    await TokenService.revokeAllForUser(testUser._id.toString());

    expect(SessionService.deleteAllSessions).toHaveBeenCalledWith(testUser._id.toString());

    const fromDb = await User.findById(testUser._id).select('+refresh_token +refresh_token_hash');
    expect(fromDb.refresh_token).toBeNull();
    expect(fromDb.refresh_token_hash).toBeNull();
  });
});
