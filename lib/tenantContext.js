const { AsyncLocalStorage } = require('async_hooks');

// Single AsyncLocalStorage instance to hold per-request tenant info
module.exports = new AsyncLocalStorage();
