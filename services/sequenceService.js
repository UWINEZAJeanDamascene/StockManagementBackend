const Sequence = require('../models/Sequence');
const mongoose = require('mongoose');

// Return zero-padded sequence string of length 5, e.g. 00001
function padSeq(n) {
  return String(n).padStart(5, '0');
}

async function nextSequence(companyId, name) {
  const year = new Date().getFullYear();
  // Atomic upsert and increment
  const res = await Sequence.findOneAndUpdate(
    { company: companyId, name, year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return padSeq(res.seq);
}

module.exports = { nextSequence };
