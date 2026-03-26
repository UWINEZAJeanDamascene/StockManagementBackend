/**
 * Debug script to check users in the database and test login
 */
require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function run() {
  // Connect to the database
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock-management';
  console.log('Connecting to:', mongoUri);
  
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  console.log('Database name:', mongoose.connection.name);
  
  // Load User model
  const User = require('../models/User');
  
  // List all users
  console.log('\n=== All Users ===');
  const users = await User.find({}, 'email role name createdAt').lean();
  users.forEach(u => {
    console.log(`- ${u.email} | ${u.role} | ${u.name || 'N/A'} | Created: ${u.createdAt}`);
  });
  
  // Check for platform_admin specifically
  console.log('\n=== Platform Admins ===');
  const platformAdmins = await User.find({ role: 'platform_admin' }).lean();
  if (platformAdmins.length === 0) {
    console.log('No platform admin users found!');
  } else {
    for (const u of platformAdmins) {
      console.log(`- ${u.email} | role: ${u.role}`);
      // Show first few chars of password hash to verify it's hashed
      if (u.password) {
        console.log(`  Password hash: ${u.password.substring(0, 30)}...`);
      } else {
        console.log('  NO PASSWORD FIELD!');
      }
    }
    
    // Test login with the first platform admin
    if (platformAdmins.length > 0) {
      const testPassword = 'SuperAdmin123'; // The password that should work
      const user = platformAdmins[0];
      
      console.log('\n=== Testing Password ===');
      console.log('Testing password for:', user.email);
      
      if (!user.password) {
        console.log('ERROR: User has no password stored!');
      } else {
        // Use bcrypt.compare to test
        const isMatch = await bcrypt.compare(testPassword, user.password);
        console.log('Password match:', isMatch);
        
        if (!isMatch) {
          console.log('\n!!! Password does not match !!!');
          console.log('Expected to test with:', testPassword);
          console.log('Hash in DB starts with:', user.password.substring(0, 20));
        }
      }
    }
  }
  
  await mongoose.connection.close();
  console.log('\nDone.');
}

run().catch(async (err) => {
  console.error('Error:', err.message);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});