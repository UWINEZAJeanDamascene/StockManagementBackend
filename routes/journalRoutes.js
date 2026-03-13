const express = require('express');
const router = express.Router();
const {
  getJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  voidJournalEntry,
  getAccounts,
  getTrialBalance,
  getGeneralLedger
} = require('../controllers/journalController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Routes
router.route('/')
  .get(getJournalEntries)
  .post(createJournalEntry);

router.route('/:id')
  .get(getJournalEntry)
  .put(updateJournalEntry)
  .delete(voidJournalEntry);

// Utility routes
router.get('/accounts', getAccounts);
router.get('/trial-balance', getTrialBalance);
router.get('/general-ledger', getGeneralLedger);

module.exports = router;
