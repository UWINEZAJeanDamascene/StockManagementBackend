/**
 * UserService Acceptance Tests
 * 
 * Tests for UserService register, login, refresh, inviteUserToCompany,
 * changePassword, and resetPassword methods
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const UserService = require('../services/UserService');
const User = require('../models/User');
const Company = require('../models/Company');
const CompanyUser = require('../models/CompanyUser');
const ActionLog = require('../models/ActionLog');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clean up test data
  await User.deleteMany({});
  await Company.deleteMany({});
  await CompanyUser.deleteMany({});
  await ActionLog.deleteMany({});
});

// Mock dependencies
jest.mock('../services/notificationHelper', () => ({
  notifyUserCreated: jest.fn().mockResolvedValue(true),
  notifyPasswordChanged: jest.fn().mockResolvedValue(true),
  notifyAccountLocked: jest.fn().mockResolvedValue(true)
}));

describe('UserService', () => {
  let testCompany;
  let testUser;

  beforeEach(async () => {
    // Create test company
    testCompany = await Company.create({
      name: 'Test Company',
      email: 'test@company.com',
      code: 'TC001',
      isActive: true,
      approvalStatus: 'approved'
    });

    // Create test user (admin)
    testUser = await User.create({
      name: 'Admin User',
      email: 'admin@test.com',
      password: 'admin123',
      company: testCompany._id,
      role: 'admin',
      isActive: true
    });
  });

  describe('register()', () => {
    it('creates user with hashed password', async () => {
      const userData = {
        email: 'newuser@test.com',
        password: 'password123',
        name: 'New User',
        companyId: testCompany._id
      };

      const result = await UserService.register(userData);

      expect(result).toBeDefined();
      expect(result.email).toBe('newuser@test.com');
      expect(result.name).toBe('New User');
      expect(result.password).toBeUndefined();

      // Verify password is hashed
      const dbUser = await User.findOne({ email: 'newuser@test.com' }).select('+password');
      expect(dbUser.password).not.toBe('password123');
      expect(dbUser.password).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt hash
    });

    it('password_hash is never returned in user object', async () => {
      const userData = {
        email: 'newuser@test.com',
        password: 'password123',
        name: 'New User',
        companyId: testCompany._id
      };

      const result = await UserService.register(userData);

      expect(result.password).toBeUndefined();
      expect(result.password_hash).toBeUndefined();
    });

    it('throws EMAIL_ALREADY_REGISTERED when email exists', async () => {
      const userData = {
        email: 'admin@test.com', // Already exists
        password: 'password123',
        name: 'Duplicate User',
        companyId: testCompany._id
      };

      await expect(UserService.register(userData))
        .rejects.toThrow('EMAIL_ALREADY_REGISTERED');
    });

    it('email stored in lowercase', async () => {
      const userData = {
        email: 'UPPER@TEST.COM',
        password: 'password123',
        name: 'Upper Case User',
        companyId: testCompany._id
      };

      const result = await UserService.register(userData);

      expect(result.email).toBe('upper@test.com');

      const dbUser = await User.findOne({ email: 'upper@test.com' });
      expect(dbUser).not.toBeNull();
    });
  });

  describe('login()', () => {
    it('returns access_token and refresh_token on success', async () => {
      const result = await UserService.login('admin@test.com', 'admin123', testCompany._id);

      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.userId).toBeDefined();
      expect(result.memberships).toBeDefined();
    });

    it('throws INVALID_CREDENTIALS for wrong password', async () => {
      await expect(UserService.login('admin@test.com', 'wrongpassword', testCompany._id))
        .rejects.toThrow('INVALID_CREDENTIALS');
    });

    it('throws INVALID_CREDENTIALS for unknown email', async () => {
      await expect(UserService.login('unknown@test.com', 'password123', testCompany._id))
        .rejects.toThrow('INVALID_CREDENTIALS');
    });

    it('increments failed_login_attempts on wrong password', async () => {
      const user = await User.findOne({ email: 'admin@test.com' });
      expect(user.failed_login_attempts).toBe(0);

      try {
        await UserService.login('admin@test.com', 'wrongpassword', testCompany._id);
      } catch (e) {
        // Expected to fail
      }

      const updatedUser = await User.findOne({ email: 'admin@test.com' });
      expect(updatedUser.failed_login_attempts).toBe(1);
    });

    it('locks account after 5 failed attempts', async () => {
      const user = await User.findOne({ email: 'admin@test.com' });

      // Try 5 failed logins
      for (let i = 0; i < 5; i++) {
        try {
          await UserService.login('admin@test.com', 'wrongpassword', testCompany._id);
        } catch (e) {
          // Expected
        }
      }

      const lockedUser = await User.findOne({ email: 'admin@test.com' });
      expect(lockedUser.locked_until).toBeDefined();
      expect(lockedUser.locked_until).toBeInstanceOf(Date);
      expect(lockedUser.locked_until > new Date()).toBe(true);
    });

    it('throws ACCOUNT_LOCKED when locked_until is in the future', async () => {
      // Lock the account
      const user = await User.findOne({ email: 'admin@test.com' });
      user.locked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
      await user.save();

      await expect(UserService.login('admin@test.com', 'admin123', testCompany._id))
        .rejects.toThrow('ACCOUNT_LOCKED');
    });

    it('resets failed_login_attempts on successful login', async () => {
      // First, increment failed attempts
      const user = await User.findOne({ email: 'admin@test.com' });
      user.failed_login_attempts = 3;
      await user.save();

      // Now login successfully
      await UserService.login('admin@test.com', 'admin123', testCompany._id);

      const updatedUser = await User.findOne({ email: 'admin@test.com' });
      expect(updatedUser.failed_login_attempts).toBe(0);
      expect(updatedUser.locked_until).toBeNull();
    });

    it('access token contains userId and memberships', async () => {
      const result = await UserService.login('admin@test.com', 'admin123', testCompany._id);

      // Decode token to verify contents (simple check)
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(result.access_token, process.env.JWT_SECRET || 'your-jwt-secret-key');

      expect(decoded.userId).toBeDefined();
      expect(decoded.memberships).toBeDefined();
      expect(Array.isArray(decoded.memberships)).toBe(true);
    });
  });

  describe('refresh()', () => {
    it('returns new access_token given valid refresh_token', async () => {
      // First login to get tokens
      const loginResult = await UserService.login('admin@test.com', 'admin123', testCompany._id);
      
      // Wait a small amount to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Now refresh
      const result = await UserService.refresh(loginResult.refresh_token);

      expect(result.access_token).toBeDefined();
      
      // Verify new token is valid
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(result.access_token, process.env.JWT_SECRET || 'your-jwt-secret-key');
      expect(decoded.userId).toBeDefined();
    });

    it('throws INVALID_REFRESH_TOKEN for expired token', async () => {
      // Create an expired refresh token
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId: testUser._id, type: 'refresh' },
        process.env.JWT_SECRET || 'your-jwt-secret-key',
        { expiresIn: '-1s' }
      );

      await expect(UserService.refresh(expiredToken))
        .rejects.toThrow('INVALID_REFRESH_TOKEN');
    });

    it('throws INVALID_REFRESH_TOKEN for tampered token', async () => {
      // First login to get valid token
      const loginResult = await UserService.login('admin@test.com', 'admin123', testCompany._id);
      
      // Tamper with the token
      const tamperedToken = loginResult.refresh_token.slice(0, -5) + 'xxxxx';

      await expect(UserService.refresh(tamperedToken))
        .rejects.toThrow('INVALID_REFRESH_TOKEN');
    });
  });

  describe('inviteUserToCompany()', () => {
    it('creates user if email not registered', async () => {
      const result = await UserService.inviteUserToCompany(testUser._id, {
        email: 'invited@test.com',
        companyId: testCompany._id,
        role: 'viewer',
        name: 'Invited User'
      });

      expect(result.isNewUser).toBe(true);
      expect(result.user.email).toBe('invited@test.com');
      expect(result.user.name).toBe('Invited User');
    });

    it('links existing user to company if email exists', async () => {
      // Create user first (without company) - platform_admin doesn't require company
      const existingUser = await User.create({
        name: 'Existing User',
        email: 'existing@test.com',
        password: 'password123',
        company: null, // No company yet
        role: 'platform_admin'
      });

      // Now invite to company
      const result = await UserService.inviteUserToCompany(testUser._id, {
        email: 'existing@test.com',
        companyId: testCompany._id,
        role: 'admin'
      });

      expect(result.isNewUser).toBe(false);
      expect(result.message).toContain('linked');
    });

    it('throws USER_ALREADY_MEMBER on duplicate invite', async () => {
      // First invite
      await UserService.inviteUserToCompany(testUser._id, {
        email: 'member@test.com',
        companyId: testCompany._id,
        role: 'viewer'
      });

      // Try to invite again
      await expect(UserService.inviteUserToCompany(testUser._id, {
        email: 'member@test.com',
        companyId: testCompany._id,
        role: 'viewer'
      })).rejects.toThrow('USER_ALREADY_MEMBER');
    });

    it('logs to audit trail', async () => {
      await UserService.inviteUserToCompany(testUser._id, {
        email: 'audit@test.com',
        companyId: testCompany._id,
        role: 'viewer',
        name: 'Audit User'
      });

      const logs = await ActionLog.find({
        company: testCompany._id,
        module: 'user'
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBeDefined();
    });
  });

  describe('changePassword()', () => {
    it('changes password successfully', async () => {
      const result = await UserService.changePassword(
        testUser._id,
        'admin123',
        'newpassword123'
      );

      expect(result.success).toBe(true);

      // Verify new password works
      const loginResult = await UserService.login('admin@test.com', 'newpassword123', testCompany._id);
      expect(loginResult.access_token).toBeDefined();
    });

    it('throws CURRENT_PASSWORD_INCORRECT for wrong current password', async () => {
      await expect(UserService.changePassword(
        testUser._id,
        'wrongpassword',
        'newpassword123'
      )).rejects.toThrow('CURRENT_PASSWORD_INCORRECT');
    });

    it('throws PASSWORD_TOO_SHORT for password under 8 characters', async () => {
      await expect(UserService.changePassword(
        testUser._id,
        'admin123',
        'short'
      )).rejects.toThrow('PASSWORD_TOO_SHORT');
    });
  });

  describe('resetPassword()', () => {
    it('resets password with valid token', async () => {
      // First request password reset
      const resetRequest = await UserService.requestPasswordReset('admin@test.com');
      const token = resetRequest.resetToken;

      // Now reset password
      const result = await UserService.resetPassword(token, 'newpass123');

      expect(result.success).toBe(true);

      // Verify new password works
      const loginResult = await UserService.login('admin@test.com', 'newpass123', testCompany._id);
      expect(loginResult.access_token).toBeDefined();
    });

    it('throws INVALID_OR_EXPIRED_TOKEN for expired reset token', async () => {
      // Create an already expired token
      const token = 'expired_token_12345';
      
      // Manually set an expired token in DB (for testing)
      const user = await User.findOne({ email: 'admin@test.com' });
      user.passwordResetToken = token;
      user.passwordResetExpires = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      await user.save();

      await expect(UserService.resetPassword(token, 'newpass123'))
        .rejects.toThrow('INVALID_OR_EXPIRED_TOKEN');
    });

    it('throws INVALID_OR_EXPIRED_TOKEN for tampered token', async () => {
      await expect(UserService.resetPassword('tampered_token', 'newpass123'))
        .rejects.toThrow('INVALID_OR_EXPIRED_TOKEN');
    });
  });
});
