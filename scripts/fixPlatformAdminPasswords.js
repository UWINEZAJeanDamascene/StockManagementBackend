/**
 * Fix script to add passwords to platform admin users who don't have them
 */
require('dotenv').config();

const mongoose = require('mongoose');
const passwordUtils = require('../utils/passwordUtils');

async function run() {
  // Connect to the database
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock-management';
  console.log('Connecting to:', mongoUri);
  
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  
  // Load User model
  const User = require('../models/User');
  
  // Find all platform admins
  const platformAdmins = await User.find({ role: 'platform_admin' });
  console.log(`Found ${platformAdmins.length} platform admin(s)`);
  
  // Set a default password for all platform admins
  const newPassword = 'SuperAdmin123';
  const hashedPassword = await passwordUtils.hash(newPassword);
  
  for (const user of platformAdmins) {
    console.log(`\nFixing user: ${user.email}`);
    console.log(`  Old password: ${user.password || 'none'}`);
    
    // Use updateOne with bypass of pre-save hook to set already-hashed password
    await User.updateOne(
      { _id: user._id },
      { password: hashedPassword }
    );
    
    console.log(`  New password set: ${newPassword}`);
  }
  
  console.log('\n=== Verifying ===');
  // Force re-load users from DB
  const updatedUsers = await User.find({ role: 'platform_admin' }).select('+password');
  for (const user of updatedUsers) {
    const isMatch = await passwordUtils.compare(newPassword, user.password);
    console.log(`${user.email}: password valid = ${isMatch}`);
  }
  
  await mongoose.connection.close();
  console.log('\nDone. You can now log in with:');
  console.log('  Email: admin@platform.com or superadmin@system.com');
  console.log(`  Password: ${newPassword}`);
}

run().catch(async (err) => {
  console.error('Error:', err.message);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});