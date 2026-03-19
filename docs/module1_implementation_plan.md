# Module 1 — Journal Entry Engine
Backend-first implementation plan (derived from module1_journal_engine_spec.md)

## Summary
- Implement `journal_entries`, `journal_entry_lines`, and seed `chart_of_accounts`.
- Add DB constraints and triggers for immutability and balancing checks.
- Implement `JournalService` to be called inside source-event transactions.
- Expose admin/accountant APIs: create manual entry, list, fetch, reverse, validate (dry-run).
- Add tests (unit, integration, e2e) matching acceptance criteria in spec.

## Files to create / modify
- `migrations/` : add migrations for new tables, constraints, sequences.
- `models/JournalEntry.js`, `models/JournalEntryLine.js`, `models/ChartOfAccount.js`.
- `services/journalService.js` : core posting, validation, idempotency, reversal.
- `controllers/journalController.js` : API endpoints for manual operations.
- `routes/journalRoutes.js` : route definitions and auth middleware.
- `tests/unit/journalService.test.js`, `tests/integration/journalApi.test.js`, `tests/e2e/journal_e2e.test.js`.
- `docs/module1_implementation_plan.md` (this file).

## Database schema (high level)

1) journal_entries
- id UUID PRIMARY KEY
- entry_date DATE NOT NULL
- reference_no VARCHAR(50) UNIQUE NOT NULL
- source_type VARCHAR NOT NULL
- source_id UUID NOT NULL
- narration TEXT NOT NULL
- currency_code CHAR(3) NOT NULL DEFAULT 'RWF'
- exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1
- status ENUM('posted','reversed','void') NOT NULL DEFAULT 'posted'
- posted_by UUID NOT NULL
- posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
- period_id UUID NOT NULL
- reversal_of_id UUID NULL REFERENCES journal_entries(id)
- tax_id UUID NULL
- created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ

Indexes / constraints:
- UNIQUE(source_type, source_id) to enforce idempotency
- UNIQUE(reference_no)

2) journal_entry_lines
- id UUID PRIMARY KEY
- journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE
- account_id UUID NOT NULL REFERENCES chart_of_accounts(id)
- dr_amount DECIMAL(18,2) NOT NULL DEFAULT 0
- cr_amount DECIMAL(18,2) NOT NULL DEFAULT 0
- description VARCHAR(255)
- entity_type VARCHAR(50)
- entity_id UUID
- tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0
- reconciled BOOLEAN DEFAULT FALSE
- created_at TIMESTAMPTZ DEFAULT now()

Database-level rules (must be enforced):
- CHECK (dr_amount = 0 OR cr_amount = 0)
- CHECK (dr_amount >= 0 AND cr_amount >= 0)
- A trigger or deferred constraint to validate SUM(dr_amount) = SUM(cr_amount) per journal_entry_id on insert (or use exclusion + deferred trigger)
- Prevent UPDATE/DELETE on entries/lines when journal_entries.status = 'posted' (trigger)

3) chart_of_accounts
- id UUID PK, code, name, type (asset|liability|equity|revenue|expense), sub_type, normal_balance, is_active, allow_direct_posting, parent_id, currency_code

4) sequences
- journal_entry_seq (per-year logic: JE-YYYY-NNNNN): implement sequence and function to generate padded numbers per year (or use a table tracking year->last_number with transaction-safe increment).

## High-level JournalService design

- API: `postForSource({ sourceType, sourceId, sourceData, txClient })` returns journal_entry record.
- Called synchronously from controllers/services that commit source record, inside the same DB transaction. Example: in `purchaseController.createGRN()` after saving GRN but before commit, call `JournalService.postForSource(...)` using same transaction client.
- Responsibilities:
  - Build lines according to mapping table (Section 4 of spec).
  - Lookup inventory cost (FIFO or WAC) when required.
  - Validate SUM(DR) == SUM(CR) — throw `JOURNAL_UNBALANCED` if not.
  - Insert `journal_entries` and `journal_entry_lines` using the provided transaction client.
  - Handle idempotency by checking UNIQUE(source_type, source_id) and returning existing entry when present.
  - On reversal: create new entry with swapped DR/CR, set `reversal_of_id`, set original status to `reversed` atomically.

## Inventory cost lookup
- Implement `InventoryCostService` with two strategies: `FIFO` and `WAC` (config per company). Provide interface `getCostForDispatch(productId, qty, txClient)`.
- For FIFO: consume earliest lots not yet consumed. Ensure the operation is non-destructive for cost lookup (the stock movement should have been recorded prior to journal posting). If lots are tracked in `inventory_batches` table, use that.

## API Endpoints (routes)

1) POST /api/journal-entries
- Manual creation (roles: accountant, admin)
- Body: entry_date, narration, currency_code (opt), lines[] {account_id, dr_amount, cr_amount, description}

2) GET /api/journal-entries
- Filters: date_from, date_to, source_type, account_id, status, page, per_page

3) GET /api/journal-entries/:id

4) POST /api/journal-entries/:id/reverse
- Body: { reason, reversal_date }

5) GET /api/journal-entries/validate
- Dry-run: accept posting payload, return computed lines and validation errors, do not persist

6) GET /api/accounting/health
- Runs the master balance check: SUM(all DR) == SUM(all CR) for posted entries

Security: use existing auth middleware; allow manual endpoints to `accountant` and `admin` only.

## Migrations & rollout plan

1) Add migration to create `chart_of_accounts` (seed minimum COA).
2) Add migration to create `journal_entries` and `journal_entry_lines` without strict triggers initially (to allow data migration/testing).
3) Seed initial accounts (codes listed in spec).
4) Add DB triggers and constraints in a separate migration once tested (balancing trigger, immutability triggers).
5) Add sequence/table for reference numbers.

Deployment notes:
- Prefer PostgreSQL; use transactions and row-level locks when generating sequential reference numbers.
- Run migrations in maintenance window for production.

## Tests to implement
- Unit tests for `JournalService.postForSource()` covering all mapping types: purchase, purchase_return, sales_invoice (both revenue+COGS), credit_note, stock_transfer, stock_audit.
- Test idempotency: repeated calls for same source return same entry.
- Test reversal creation and original status set to 'reversed'.
- Integration tests for API endpoints and permission checks.
- E2E tests: simulate PO -> GRN -> verify journal entry and inventory balance; Sales invoice -> verify revenue+COGS entries.

## Implementation steps (backend-first)
1) Confirm DB choice (Postgres recommended) and company-level configs (FIFO vs WAC, base currency, multi-tenant).
2) Create migrations and models for `chart_of_accounts`, `journal_entries`, `journal_entry_lines`.
3) Seed COA.
4) Implement `InventoryCostService` (FIFO/WAC) using existing inventory/batch tables.
5) Implement `JournalService.postForSource()` with mapping logic for each `source_type` from Section 4.
6) Add API endpoints & controllers for manual operations and validation.
7) Add DB triggers/constraints for immutability and balancing checks.
8) Add unit/integration tests and run CI.

## Next actions I will take (if you confirm)
- Create migration SQL files and model files for `journal_entries` and `journal_entry_lines`.
- Implement `services/journalService.js` skeleton and tests for basic posting and idempotency.

If this plan looks good, confirm: do you want FIFO (recommended) or WAC? Also confirm the DB (Postgres?) and whether the system is multi-company (add `company_id` to tables).

----
Generated from: module1_journal_engine_spec.md
