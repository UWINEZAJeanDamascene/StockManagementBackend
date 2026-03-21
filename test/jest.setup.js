const mongoose = require('mongoose');

// CRITICAL: Set JWT_SECRET before any services are loaded
// This must be at TOP LEVEL before any require() statements in test files
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test_jwt_secret_for_testing_only';
}
if (!process.env.JWT_EXPIRE) {
  process.env.JWT_EXPIRE = '1h';
}
process.env.NODE_ENV = 'test';

// Increase mongoose promise warnings handling
mongoose.set('strictQuery', false);

module.exports = async () => {
  // Additional test setup can go here
};
