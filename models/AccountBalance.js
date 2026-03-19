const mongoose = require('mongoose');
const { Schema } = mongoose;

const AccountBalanceSchema = new Schema({
  company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  accountCode: { type: String, required: true, index: true },
  debit: { type: Number, default: 0, min: 0 },
  credit: { type: Number, default: 0, min: 0 },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: false });

// Virtual net balance (debit - credit)
AccountBalanceSchema.virtual('net').get(function() {
  return (this.debit || 0) - (this.credit || 0);
});

// Static helper to adjust balances atomically (upsert)
AccountBalanceSchema.statics.adjust = async function(companyId, accountCode, deltaDebit = 0, deltaCredit = 0, options = {}) {
  const session = options.session;
  const query = { company: companyId, accountCode };
  // Ensure we never decrement below zero in the schema; caller should ensure data validity.
  const update = {
    $inc: { debit: deltaDebit, credit: deltaCredit },
    $set: { updatedAt: new Date() }
  };
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;

  return this.findOneAndUpdate(query, update, opts).lean();
};

// Create a compound index to keep lookups fast
AccountBalanceSchema.index({ company: 1, accountCode: 1 }, { unique: true });

module.exports = mongoose.model('AccountBalance', AccountBalanceSchema);
