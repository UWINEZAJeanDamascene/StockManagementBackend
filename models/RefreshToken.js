const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    token_hash: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expires_at: { type: Date, required: true },
    is_revoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ token_hash: 1 }, { unique: true });
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
refreshTokenSchema.index({ user_id: 1, is_revoked: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema, 'refresh_tokens');
