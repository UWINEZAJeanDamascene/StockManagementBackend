const mongoose = require('mongoose');

const AccountMappingSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  module: { type: String, required: true },
  key: { type: String, required: true },
  // accountCode may be a single code (string), a comma-separated string,
  // an array of codes, or a pattern/range (string). Store as Mixed to allow flexibility.
  accountCode: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Unique mapping per company/module/key
AccountMappingSchema.index({ company: 1, module: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('AccountMapping', AccountMappingSchema);
