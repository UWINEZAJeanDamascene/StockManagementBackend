const mongoose = require('mongoose');

// Import centralized configuration
const env = require('../src/config/environment');

/**
 * Pool and timeout options for production load (overridable via environment).
 */
function buildMongooseConnectOptions() {
  const config = env.getConfig();
  const dbConfig = config.db;
  
  const maxPoolSize = Math.max(10, dbConfig.maxPoolSize);
  const minPoolSize = Math.max(0, dbConfig.minPoolSize);

  return {
    maxPoolSize,
    minPoolSize,
    serverSelectionTimeoutMS: dbConfig.serverSelectionTimeoutMs,
    socketTimeoutMS: dbConfig.socketTimeoutMs,
    connectTimeoutMS: dbConfig.connectTimeoutMs,
    heartbeatFrequencyMS: dbConfig.heartbeatFrequencyMs,
  };
}

const connectDB = async () => {
  try {
    const config = env.getConfig();
    const dbUri = config.db.uri;
    
    if (!dbUri) {
      console.error('Error: MONGODB_URI is not defined in environment');
      process.exit(1);
    }

    const conn = await mongoose.connect(dbUri, buildMongooseConnectOptions());

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.buildMongooseConnectOptions = buildMongooseConnectOptions;
