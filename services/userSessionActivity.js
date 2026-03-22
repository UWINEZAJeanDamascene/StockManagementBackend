const UserSession = require('../models/UserSession');

/**
 * Updates MongoDB user_sessions.last_active_at for authenticated requests.
 * Fire-and-forget — does not block the response path.
 */
function recordUserSessionActivity(userId) {
  if (!userId) return;
  setImmediate(() => {
    UserSession.findOneAndUpdate(
      { user_id: userId },
      { $set: { last_active_at: new Date(), is_active: true } },
      { upsert: true }
    ).catch(() => {});
  });
}

module.exports = { recordUserSessionActivity };
