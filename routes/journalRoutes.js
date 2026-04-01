const express = require('express');
const router = express.Router();
const {
  getJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  voidJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  getAccounts,
  getTrialBalance,
  getGeneralLedger,
  runDepreciation,
  exportJournalEntries
} = require('../controllers/journalController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Routes
router.route('/')
  .get(getJournalEntries)
  .post(createJournalEntry);

// Utility routes (must come before parameterized routes)
router.get('/accounts', getAccounts);
router.get('/trial-balance', getTrialBalance);
router.get('/general-ledger', getGeneralLedger);
router.get('/export', exportJournalEntries);
router.post('/run-depreciation', runDepreciation);

router.route('/:id')
  .get(getJournalEntry)
  .put(updateJournalEntry)
  .delete(voidJournalEntry);

// Post (finalize) a journal entry
router.put('/:id/post', postJournalEntry);

// Reverse a posted journal entry
router.post('/:id/reverse', reverseJournalEntry);

module.exports = router;
