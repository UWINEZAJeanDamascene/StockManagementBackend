const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

async function hash(plain) {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(plain, salt);
}

async function compare(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = {
  hash,
  compare,
  BCRYPT_ROUNDS,
};
