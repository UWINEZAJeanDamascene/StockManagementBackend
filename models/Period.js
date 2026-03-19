const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open' }
}, { timestamps: true });

periodSchema.index({ company: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('Period', periodSchema);
