require('dotenv').config();
const target = process.argv[2] || process.env.TEST_EMAIL_TO;
if (!target) {
  console.error('Usage: node scripts/submit-forgot.js user@example.com');
  process.exit(1);
}

(async () => {
  try {
    const UserService = require('../services/UserService');
    console.log('[SubmitForgot] Requesting password reset for:', target);
    const result = await UserService.requestPasswordReset(target);
    console.log('[SubmitForgot] Result:', result);
    process.exit(0);
  } catch (err) {
    console.error('[SubmitForgot] Error:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
