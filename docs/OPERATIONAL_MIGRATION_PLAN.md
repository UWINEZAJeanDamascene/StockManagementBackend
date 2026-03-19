# Operational Migration Plan: AccountBalance Backfill & Index Creation

This document describes safe steps to backfill the `AccountBalance` collection from existing posted journal entries and to create the unique index used for idempotency and immutability checks.

Preconditions
- Take a full database backup (mongodump) before any migration.
- Ensure the target MongoDB is running as a replica set (required for transactions).
- Run the backfill first in `--dry-run` mode to inspect results.

Steps
1. Dry-run backfill (no writes)
   - From the app server or CI environment run:
     ```bash
     node scripts/backfill_account_balances.js --dry-run
     ```
   - Inspect output for unexpected large balances or duplicate account codes.

2. Resolve duplicates in `journalentries` for the partial-unique index
   - Run the migrate_journal_engine.js script in dry-run to detect duplicate `(company, sourceType, sourceId)` groups.
   - For any duplicates found, review business source (invoices/purchases/payments) and decide whether to delete duplicate journal entries or to merge/remove duplicates.

3. Run backfill (non-dry)
   - After confirming dry-run output, run:
     ```bash
     node scripts/backfill_account_balances.js --dry=false
     ```
   - Monitor logs and check that `AccountBalance` documents are created/updated as expected.

4. Create partial unique index for JournalEntry idempotency
   - Ensure no duplicates remain. Then create the index (example using mongo shell):
     ```js
     db.journalentries.createIndex({ company: 1, sourceType: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $exists: true, $ne: null } } })
     ```

5. Apply collection validator to ensure posted entries are balanced (optional)
   - Use `collMod` to add a validator that enforces `totalDebit === totalCredit` for `status: 'posted'`.

6. Smoke tests
   - Post a few manual transactions via the API and confirm:
     - `AccountBalance` updates match expectations
     - `GET /api/journal-entries/trial-balance` totals match debits/credits
     - P&L and Balance Sheet reports reconcile (current period profit flows to equity)

Rollback
- If issues occur, restore from the backup taken in step 0.

Notes
- If your MongoDB is not a replica set, you can still run the backfill, but you will not get transactional guarantees for concurrent writes; schedule migration during low activity.
- Always run dry-run steps in CI before production execution.
