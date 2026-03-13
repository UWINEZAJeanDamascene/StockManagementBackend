/**
 * Email Configuration Test Script (Production-ready)
 *
 * Usage:  node scripts/testEmail.js
 *         node scripts/testEmail.js recipient@example.com
 *
 * Tests:
 *  1. Environment variable validation
 *  2. SMTP connection verification
 *  3. Send a test email (if recipient provided)
 */

require('dotenv').config();

const { testConnection, validateConfig } = require('../config/email');
const { sendEmail } = require('../services/emailService');

const run = async () => {
  console.log('========================================');
  console.log('  StockManager — Email Test (Production)');
  console.log('========================================');

  // 1. Validate env
  console.log('\n--- Step 1: Validate Environment ---');
  const { provider, valid, missing } = validateConfig();
  console.log(`Provider : ${provider}`);
  console.log(`From     : ${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`);
  console.log(`Frontend : ${process.env.FRONTEND_URL}`);
  console.log(`NODE_ENV : ${process.env.NODE_ENV || 'not set'}`);

  if (!valid) {
    console.error(`\n⛔ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ All required env vars present');

  // 2. Test SMTP connection
  console.log('\n--- Step 2: Verify SMTP Connection ---');
  const connected = await testConnection();
  if (!connected) {
    console.error('\n⛔ SMTP connection failed — check credentials');
    process.exit(1);
  }

  // 3. Send test email (optional)
  const recipient = process.argv[2];
  if (recipient) {
    console.log(`\n--- Step 3: Sending test email to ${recipient} ---`);

    const html = `
      <div style="font-family:Arial,sans-serif; max-width:600px; margin:0 auto;">
        <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9); padding:30px; border-radius:10px 10px 0 0;">
          <h1 style="color:white; margin:0; text-align:center;">🧪 Production Email Test</h1>
        </div>
        <div style="background:#f9f9f9; padding:30px; border:1px solid #ddd; border-top:none; border-radius:0 0 10px 10px;">
          <p>If you see this, the StockManager email system is <b style="color:#10b981;">production-ready</b>.</p>
          <table style="width:100%; margin:20px 0;">
            <tr><td style="padding:6px 0;"><strong>Provider:</strong></td><td>${provider}</td></tr>
            <tr><td style="padding:6px 0;"><strong>NODE_ENV:</strong></td><td>${process.env.NODE_ENV || 'not set'}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Timestamp:</strong></td><td>${new Date().toISOString()}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Node:</strong></td><td>${process.version}</td></tr>
          </table>
          <p style="font-size:12px; color:#888;">Features: connection pooling · retry with backoff · XSS sanitization · email validation</p>
          <hr style="border:none; border-top:1px solid #ddd; margin:20px 0;"/>
          <p style="font-size:12px; color:#888; text-align:center;">StockManager — Email System Test</p>
        </div>
      </div>`;

    const ok = await sendEmail(recipient, '🧪 StockManager Production Email Test', html);
    if (ok) {
      console.log(`\n✅ Test email sent successfully to ${recipient}`);
    } else {
      console.error(`\n❌ Failed to send test email to ${recipient}`);
      process.exit(1);
    }
  } else {
    console.log('\n💡 To also send a test email, run:');
    console.log('   node scripts/testEmail.js your@email.com');
  }

  console.log('\n========================================');
  console.log('  All checks passed ✅');
  console.log('========================================');
  process.exit(0);
};

run();
