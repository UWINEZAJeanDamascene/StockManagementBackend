/**
 * UserService - Business Logic for User Management
 * 
 * Implements user authentication, registration, and management
 * as per acceptance test specifications
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const CompanyUser = require('../models/CompanyUser');
const Company = require('../models/Company');
const SessionService = require('./sessionService');
const TokenService = require('./tokenService');
const { notifyUserCreated, notifyPasswordChanged, notifyAccountLocked } = require('./notificationHelper');
const ActionLog = require('../models/ActionLog');

// Import centralized configuration
const env = require('../src/config/environment');
const config = env.getConfig();

// Validate required config - JWT_SECRET MUST be set in environment
if (!config.jwt.secret) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Please set it in your .env file.');
}
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;
const MIN_PASSWORD_LENGTH = 8;

/** Bcrypt work comparable to real logins, so unknown-email failures do not return much faster than wrong-password. */
let loginTimingDummyHash;
function getLoginTimingDummyHash() {
  if (!loginTimingDummyHash) {
    loginTimingDummyHash = bcrypt.hashSync('__login_unknown_user_timing__', 12);
  }
  return loginTimingDummyHash;
}

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

    // Look up the Role document by name to link it to the user
    const roleDoc = await Role.findOne({ name: role, is_system_role: true });

    // Create user (password will be hashed by pre-save hook)
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      company: companyId,
      role,
      roles: roleDoc ? [roleDoc._id] : [],
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
      await bcrypt.compare(password, getLoginTimingDummyHash());
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
    
    const memberships = [{
      companyId: user.company?.toString(),
      role: user.role
    }];
    const { access_token: accessToken, refresh_token: refreshToken } = TokenService.buildTokenPair(user, memberships);
    await user.save();

    const companyIdStr = user.company?.toString() || null;
    try {
      await SessionService.createSession(
        user._id.toString(),
        companyIdStr,
        user.role,
        accessToken,
        { email: user.email, name: user.name }
      );
    } catch (e) {
      console.error('Session creation on login failed (tokens still issued):', e);
    }

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
    return TokenService.refreshWithRotation(refreshToken);
  }

  /**
   * Force logout from all devices — clears refresh token and all sessions for user.
   */
  static async forceLogoutAllSessions(userId) {
    await TokenService.revokeAllForUser(userId);
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
      // Look up the Role document by name to link it to the user
      const roleDoc = await Role.findOne({ name: role, is_system_role: true });

      // Create new user
      const tempPassword = crypto.randomBytes(8).toString('hex');
      user = await User.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        password: tempPassword,
        company: companyId,
        role,
        roles: roleDoc ? [roleDoc._id] : [],
        isActive: true,
        mustChangePassword: true,
        createdBy: inviterId,
        failed_login_attempts: 0,
        locked_until: null
      });
      isNewUser = true;
    } else {
      // Look up the Role document by name to link it to the user
      const roleDoc = await Role.findOne({ name: role, is_system_role: true });

      // Link existing user to company using CompanyUser
      await CompanyUser.create({
        user: user._id,
        company: companyId,
        role,
        status: 'active',
        approvedBy: inviterId,
        approvedAt: new Date()
      });

      // Also update the user's role and roles array if they don't have one
      if (!user.roles || user.roles.length === 0) {
        user.role = role;
        user.roles = roleDoc ? [roleDoc._id] : [];
        await user.save();
      }
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
    console.log('[PasswordReset] Request received for:', email);
    
    const user = await User.findByEmail(email);
    console.log('[PasswordReset] User found:', user ? user.email : 'not found');
    
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
    console.log('[PasswordReset] Token saved for user:', user.email);

    // Send password reset email
    let emailSent = false;
    try {
      const config = require('../src/config/environment').getConfig();
      console.log('[PasswordReset] Config check:', { emailNotif: config.features?.emailNotifications, gmailUser: !!config.email?.gmailUser });
      
      if (config.features?.emailNotifications && config.email?.gmailUser) {
        const emailService = require('./emailService');
        await emailService.sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetToken
        });
        emailSent = true;
        console.log('[PasswordReset] Email sent successfully to:', user.email);
      } else {
        console.log('[PasswordReset] Email NOT sent - config check failed');
      }
    } catch (emailErr) {
      console.error('[PasswordReset] Failed to send password reset email:', emailErr.message);
    }

    return {
      success: true,
      message: emailSent ? 'Password reset link sent to your email' : 'Password reset link sent (email delivery may be delayed)'
    };
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    const user = await User.findById(userId)
      .populate('company', 'name email')
      .populate('roles');
    if (!user) {
      throw new Error('User not found');
    }

    const userObj = user.toJSON();

    // Compute flat permissions array from populated roles
    const permissionsSet = new Set();

    // Admin and platform_admin get wildcard permissions
    if (user.role === 'admin' || user.role === 'platform_admin') {
      permissionsSet.add('*');
    }

    if (user.roles && user.roles.length > 0) {
      for (const role of user.roles) {
        if (role.permissions && role.permissions.length > 0) {
          for (const perm of role.permissions) {
            if (perm.resource === '*') {
              const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
              for (const action of (perm.actions.includes('*') ? allActions : perm.actions)) {
                permissionsSet.add(`*:${action}`);
              }
              if (perm.actions.includes('*')) {
                permissionsSet.add('*');
              }
            } else {
              for (const action of perm.actions) {
                if (action === '*') {
                  permissionsSet.add(`${perm.resource}:*`);
                  const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
                  for (const a of allActions) {
                    permissionsSet.add(`${perm.resource}:${a}`);
                  }
                } else {
                  permissionsSet.add(`${perm.resource}:${action}`);
                }
              }
            }
          }
        }
      }
    } else if (user.role && user.role !== 'admin' && user.role !== 'platform_admin') {
      // Fallback: look up the Role document by the legacy role string name
      const legacyRole = await Role.findOne({ name: user.role, is_system_role: true });
      if (legacyRole && legacyRole.permissions && legacyRole.permissions.length > 0) {
        for (const perm of legacyRole.permissions) {
          if (perm.resource === '*') {
            const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
            for (const action of (perm.actions.includes('*') ? allActions : perm.actions)) {
              permissionsSet.add(`*:${action}`);
            }
            if (perm.actions.includes('*')) {
              permissionsSet.add('*');
            }
          } else {
            for (const action of perm.actions) {
              if (action === '*') {
                permissionsSet.add(`${perm.resource}:*`);
                const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
                for (const a of allActions) {
                  permissionsSet.add(`${perm.resource}:${a}`);
                }
              } else {
                permissionsSet.add(`${perm.resource}:${action}`);
              }
            }
          }
        }
      }
    }

    userObj.permissions = Array.from(permissionsSet);
    return userObj;
  }

  /**
   * Update user
   */
  static async updateUser(userId, updateData) {
    // Don't allow password update through this method
    delete updateData.password;
    delete updateData.refresh_token;
    delete updateData.refresh_token_hash;
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
