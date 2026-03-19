const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true },
  year: { type: Number, required: true },
  seq: { type: Number, default: 0 }
}, { timestamps: true });

sequenceSchema.index({ company: 1, name: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Sequence', sequenceSchema);
