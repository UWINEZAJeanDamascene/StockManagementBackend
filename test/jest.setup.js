const mongoose = require('mongoose');

// Increase mongoose promise warnings handling
mongoose.set('strictQuery', false);

module.exports = async () => {
  // nothing here - individual tests will manage connections
};
