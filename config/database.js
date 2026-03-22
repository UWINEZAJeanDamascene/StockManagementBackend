const mongoose = require('mongoose');

/**
 * Pool and timeout options for production load (overridable via environment).
 */
function buildMongooseConnectOptions() {
  const maxPoolSize = Math.max(
    10,
    parseInt(process.env.MONGODB_MAX_POOL_SIZE || '50', 10) || 50
  );
  const minPoolSize = Math.max(
    0,
    parseInt(process.env.MONGODB_MIN_POOL_SIZE || '0', 10) || 0
  );

  return {
    maxPoolSize,
    minPoolSize,
    serverSelectionTimeoutMS: parseInt(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '30000',
      10
    ),
    socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '0', 10),
    connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '30000', 10),
    heartbeatFrequencyMS: parseInt(
      process.env.MONGODB_HEARTBEAT_FREQUENCY_MS || '10000',
      10
    ),
  };
}

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error('Error: MONGODB_URI is not defined in environment');
      process.exit(1);
    }

    const conn = await mongoose.connect(
      process.env.MONGODB_URI,
      buildMongooseConnectOptions()
    );

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
