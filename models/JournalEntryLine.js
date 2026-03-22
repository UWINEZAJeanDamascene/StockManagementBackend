const mongoose = require('mongoose');

/**
 * Denormalized journal line rows for indexed line-level queries (company + account / entry).
 * Optional: populated alongside JournalEntry for reporting; indexes satisfy audit 7.1.
 */
const journalEntryLineSchema = new mongoose.Schema(
  {
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    journal_entry_id: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
  },
  { timestamps: true },
);

journalEntryLineSchema.index({ company_id: 1, account_id: 1 });
journalEntryLineSchema.index({ company_id: 1, journal_entry_id: 1 });

module.exports = mongoose.model('JournalEntryLine', journalEntryLineSchema, 'journal_entry_lines');
