const mongoose = require('mongoose');

/**
 * Run an operation inside a MongoDB session/transaction when available.
 * If transactions are not supported (in-memory Mongo or single-node),
 * falls back to invoking the operation without a session.
 *
 * Usage: await runInTransaction(async (session) => { ... use session in mongoose ops ... });
 */
async function runInTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async (trx) => {
      result = await operation(trx);
    });
    session.endSession();
    return result;
  } catch (err) {
    // Detect common message when transactions unsupported in this environment
    if (err && /Transaction numbers are only allowed/.test(err.message)) {
      console.warn('Transaction unsupported, falling back to non-transactional execution:', err.message);
      try {
        const res = await operation(null);
        return res;
      } catch (e) {
        throw e;
      }
    }
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

module.exports = { runInTransaction };
