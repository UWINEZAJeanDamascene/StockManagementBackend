require('dotenv').config();
const path = require('path');

const recipient = process.argv[2] || process.env.TEST_EMAIL_TO;
if (!recipient) {
  console.error('Usage: node scripts/test-email.js recipient@example.com');
  process.exit(1);
}

(async () => {
  try {
    const emailService = require('../services/emailService');
    const emailConfig = require('../src/config/environment').getConfig().email;
    const { testConnection } = require('../config/email');

    console.log('Verifying email transport...');
    const ok = await testConnection();
    if (!ok) {
      console.error('Email transport verification failed. Check SMTP/Gmail settings.');
      process.exit(2);
    }

    const result = await emailService.sendPasswordResetEmail({
      to: recipient,
      name: 'Test User',
      resetToken: `test-${Date.now()}`
    });

    console.log('sendPasswordResetEmail result:', result);
    process.exit(0);
  } catch (err) {
    console.error('Test email failed:', err && err.message ? err.message : err);
    process.exit(3);
  }
})();
