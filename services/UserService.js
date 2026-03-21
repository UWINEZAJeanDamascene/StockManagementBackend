/**
 * UserService - Business Logic for User Management
 * 
 * Implements user authentication, registration, and management
 * as per acceptance test specifications
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const CompanyUser = require('../models/CompanyUser');
const Company = require('../models/Company');
const SessionService = require('./sessionService');
const { notifyUserCreated, notifyPasswordChanged, notifyAccountLocked } = require('./notificationHelper');
const ActionLog = require('../models/ActionLog');

// Configuration - JWT_SECRET MUST be set in environment
if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Please set it in your .env file.');
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
const REFRESH_TOKEN_EXPIRE = process.env.REFRESH_TOKEN_EXPIRE || '7d';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Generate access token
 * Uses 'id' for backward compatibility with auth middleware
 */
const generateAccessToken = (userId, memberships) => {
  return jwt.sign(
    { id: userId, userId, memberships },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRE }
  );
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

/**
 * Generate password reset token
 */
const generatePasswordResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

class UserService {
  /**
   * Register a new user
   * Creates user with hashed password, email stored in lowercase
   * @throws EMAIL_ALREADY_REGISTERED when email exists
   */
  static async register(userData) {
    const { email, password, name, companyId, role = 'viewer' } = userData;

    // Check if user already exists with this email (case-insensitive)
    const existingUser = await User.findByEmail(email, companyId);
    if (existingUser) {
      const error = new Error('EMAIL_ALREADY_REGISTERED');
      error.code = 'EMAIL_ALREADY_REGISTERED';
      throw error;
    }

    // Validate password length
    if (password.length < MIN_PASSWORD_LENGTH) {
      const error = new Error('PASSWORD_TOO_SHORT');
      error.code = 'PASSWORD_TOO_SHORT';
      throw error;
    }

    // Create user (password will be hashed by pre-save hook)
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      company: companyId,
      role,
      isActive: true,
      failed_login_attempts: 0,
      locked_until: null
    });

    // Return user without password
    return user.toJSON();
  }

  /**
   * Login user
   * @throws INVALID_CREDENTIALS for wrong password or unknown email
   * @throws ACCOUNT_LOCKED when locked_until is in the future
   * Returns access_token and refresh_token
   */
  static async login(email, password, companyId = null) {
    // Find user by email
    const user = await User.findByEmail(email, companyId).select('+password');
    
    if (!user) {
      const error = new Error('INVALID_CREDENTIALS');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Check if account is locked
    if (user.isLocked()) {
      const error = new Error('ACCOUNT_LOCKED');
      error.code = 'ACCOUNT_LOCKED';
      error.lockedUntil = user.locked_until;
      throw error;
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      // Increment failed login attempts
      await user.incrementFailedLoginAttempts(MAX_LOGIN_ATTEMPTS, LOCK_DURATION_MINUTES);
      
      const error = new Error('INVALID_CREDENTIALS');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Check if user is active
    if (!user.isActive) {
      const error = new Error('INVALID_CREDENTIALS');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Check company status (for non-platform admins)
    if (user.role !== 'platform_admin' && companyId) {
      const company = await Company.findById(companyId);
      if (!company || !company.isActive) {
        const error = new Error('INVALID_CREDENTIALS');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }
      if (company.approvalStatus !== 'approved') {
        const error = new Error('INVALID_CREDENTIALS');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }
    }

    // Reset failed login attempts on successful login
    user.resetFailedLoginAttempts();
    
    // Update last login
    user.lastLogin = new Date();
    
    // Generate tokens
    const accessToken = generateAccessToken(user._id.toString(), [{
      companyId: user.company?.toString(),
      role: user.role
    }]);
    const refreshToken = generateRefreshToken(user._id.toString());
    
    // Save refresh token
    user.refresh_token = refreshToken;
    await user.save();

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      userId: user._id.toString(),
      memberships: [{
        companyId: user.company?.toString(),
        role: user.role
      }]
    };
  }

  /**
   * Refresh access token
   * @throws INVALID_REFRESH_TOKEN for expired or tampered token
   */
  static async refresh(refreshToken) {
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    if (!decoded || decoded.type !== 'refresh') {
      const error = new Error('INVALID_REFRESH_TOKEN');
      error.code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    // Find user and verify refresh token matches
    const user = await User.findById(decoded.userId).select('+refresh_token');
    
    if (!user || user.refresh_token !== refreshToken) {
      const error = new Error('INVALID_REFRESH_TOKEN');
      error.code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    // Generate new access token
    const accessToken = generateAccessToken(user._id.toString(), [{
      companyId: user.company?.toString(),
      role: user.role
    }]);

    return { access_token: accessToken };
  }

  /**
   * Invite user to company
   * Creates user if email not registered, links existing user if already registered
   * @throws USER_ALREADY_MEMBER on duplicate invite
   */
  static async inviteUserToCompany(inviterId, inviteData) {
    const { email, companyId, role = 'viewer', name } = inviteData;

    // Check if user is already a member of this company
    const existingMember = await User.findOne({ email: email.toLowerCase(), company: companyId });
    if (existingMember) {
      const error = new Error('USER_ALREADY_MEMBER');
      error.code = 'USER_ALREADY_MEMBER';
      throw error;
    }

    // Check if there's an existing user with this email on the platform
    let user = await User.findByEmail(email);

    let isNewUser = false;
    if (!user) {
      // Create new user
      const tempPassword = crypto.randomBytes(8).toString('hex');
      user = await User.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        password: tempPassword,
        company: companyId,
        role,
        isActive: true,
        mustChangePassword: true,
        createdBy: inviterId,
        failed_login_attempts: 0,
        locked_until: null
      });
      isNewUser = true;
    } else {
      // Link existing user to company using CompanyUser
      await CompanyUser.create({
        user: user._id,
        company: companyId,
        role,
        status: 'active',
        approvedBy: inviterId,
        approvedAt: new Date()
      });
    }

    // Log to audit trail
    try {
      await ActionLog.create({
        user: inviterId,
        company: companyId,
        action: isNewUser ? 'user_created' : 'user_linked',
        module: 'user',
        details: {
          invitedEmail: email,
          role,
          isNewUser
        }
      });
    } catch (e) {
      console.error('Failed to log audit trail:', e);
    }

    // Send notification
    try {
      const inviter = await User.findById(inviterId);
      await notifyUserCreated(companyId, user, inviter);
    } catch (e) {
      console.error('Failed to send notification:', e);
    }

    return {
      user: user.toJSON(),
      isNewUser,
      message: isNewUser ? 'User created and invited' : 'User linked to company'
    };
  }

  /**
   * Change password
   * @throws CURRENT_PASSWORD_INCORRECT for wrong current password
   * @throws PASSWORD_TOO_SHORT for password under 8 characters
   */
  static async changePassword(userId, currentPassword, newPassword) {
    // Validate password length
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      const error = new Error('PASSWORD_TOO_SHORT');
      error.code = 'PASSWORD_TOO_SHORT';
      throw error;
    }

    // Find user with password
    const user = await User.findById(userId).select('+password');
    
    if (!user) {
      const error = new Error('User not found');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      const error = new Error('CURRENT_PASSWORD_INCORRECT');
      error.code = 'CURRENT_PASSWORD_INCORRECT';
      throw error;
    }

    // Update password
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.tempPassword = false;
    await user.save();

    // Notify password changed
    try {
      await notifyPasswordChanged(user.company, user._id);
    } catch (e) {
      console.error('Failed to send notification:', e);
    }

    return { success: true, message: 'Password changed successfully' };
  }

  /**
   * Reset password with valid token
   * @throws INVALID_OR_EXPIRED_TOKEN for expired reset token
   */
  static async resetPassword(token, newPassword) {
    // Validate password length
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      const error = new Error('PASSWORD_TOO_SHORT');
      error.code = 'PASSWORD_TOO_SHORT';
      throw error;
    }

    // Find user with valid reset token
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken');

    if (!user) {
      const error = new Error('INVALID_OR_EXPIRED_TOKEN');
      error.code = 'INVALID_OR_EXPIRED_TOKEN';
      throw error;
    }

    // Update password
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.tempPassword = false;
    
    // Clear reset token
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    
    await user.save();

    return { success: true, message: 'Password reset successfully' };
  }

  /**
   * Request password reset (generate token)
   */
  static async requestPasswordReset(email) {
    const user = await User.findByEmail(email);
    
    if (!user) {
      // Don't reveal if email exists
      return { success: true, message: 'If email exists, reset link will be sent' };
    }

    // Generate reset token
    const resetToken = generatePasswordResetToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = resetExpires;
    await user.save();

    // In production, send email with reset link
    // For now, return the token (for testing)
    return {
      success: true,
      message: 'Password reset link sent',
      resetToken // Remove in production
    };
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return user.toJSON();
  }

  /**
   * Update user
   */
  static async updateUser(userId, updateData) {
    // Don't allow password update through this method
    delete updateData.password;
    delete updateData.refresh_token;
    delete updateData.failed_login_attempts;
    delete updateData.locked_until;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    return user.toJSON();
  }

  /**
   * Get users for a company
   */
  static async getUsers(companyId, options = {}) {
    const { page = 1, limit = 20, role, isActive, search } = options;
    
    const query = { company: companyId };
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    return {
      data: users.map(u => u.toJSON()),
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        limit
      }
    };
  }
}

// Export error codes for convenience
UserService.ERRORS = User.ERRORS;

module.exports = UserService;
