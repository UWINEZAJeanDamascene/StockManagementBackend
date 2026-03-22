const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    is_active: { type: Boolean, default: true },
    last_active_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

userSessionSchema.index({ user_id: 1, is_active: 1 });
userSessionSchema.index({ last_active_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('UserSession', userSessionSchema, 'user_sessions');
