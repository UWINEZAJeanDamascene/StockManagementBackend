
STOCK MANAGEMENT SYSTEM

Module 1: Journal Entry Auto-Posting Engine
Engineering Specification & Implementation Guide

Version
1.0 — Initial Release
Module
1 of 7 — Finance Automation Series
Scope
Auto-generate double-entry journal entries from every stock transaction
Feeds into
General Ledger → Trial Balance → P&L → Balance Sheet → Cash Flow → Ratios

This document is the single source of truth for implementing Module 1. Read every section before writing code. Do NOT proceed to Module 2 until this module passes all acceptance tests listed in Section 9.

# 1. Objective

Every business event in the stock management system must automatically produce a balanced double-entry journal entry. No manual bookkeeping. No batch jobs. Real-time posting on transaction commit.

The output of this module is the foundation of the entire financial reporting chain:

Transaction  →  Journal Entry  →  Ledger  →  Trial Balance  →  P&L  →  Balance Sheet  →  Cash Flow  →  Ratios

If this module is wrong, every downstream report is wrong. Build it correctly first.

# 2. Core Accounting Concepts (Read First)

Before writing a single line of code, make sure you fully understand these rules. They are non-negotiable accounting principles.

## 2.1  The Double-Entry Rule

Every financial transaction must be recorded with at least two entries: one Debit (DR) and one Credit (CR). The total of all Debits must always equal the total of all Credits in the same journal entry. This is absolute — there are no exceptions.

RULE: SUM(DR amounts) = SUM(CR amounts) for every single journal entry. If your code produces an entry where this is not true, the entry must be rejected and an error raised.

## 2.2  Debit and Credit Behaviour by Account Type

Different account types increase or decrease differently. This table must be hardcoded as a reference in your accounting engine:

Account Type
Increases with
Decreases with
Normal Balance
Asset
DR (Debit)
CR (Credit)
Debit
Liability
CR (Credit)
DR (Debit)
Credit
Equity
CR (Credit)
DR (Debit)
Credit
Revenue
CR (Credit)
DR (Debit)
Credit
Expense / COGS
DR (Debit)
CR (Credit)
Debit

## 2.3  Inventory Valuation Method

You must implement one of the following inventory costing methods. The choice affects the value that hits COGS when goods are dispatched. This must be configured at the system/company level before go-live and must not change mid-period without a formal adjustment entry.

Method
How COGS cost is determined
Recommended for
FIFO
First units purchased are first units sold. Cost of oldest stock is used for COGS.
Most businesses. Default recommendation.
WAC
Weighted Average Cost. COGS = Total inventory value / Total units on hand, recalculated on every purchase.
Commodities, bulk goods, fungible items.

# 3. Database Schema

This section defines the exact tables and fields required. Do not deviate from this schema without confirming with the product owner. Every field listed is required unless explicitly marked optional.

## 3.1  journal_entries table

One row per journal entry (a complete balanced transaction). Parent record only — no financial amounts at this level.

Field
Type
Constraints
Description
id
UUID / BIGINT
PK, NOT NULL
Unique entry ID
entry_date
DATE
NOT NULL
Business date of transaction
reference_no
VARCHAR(50)
UNIQUE, NOT NULL
Auto-generated (e.g. JE-2025-00001)
source_type
ENUM
NOT NULL
See Section 4 for full list
source_id
UUID / BIGINT
NOT NULL, INDEX
FK to triggering record
narration
TEXT
NOT NULL
Human-readable description
currency_code
CHAR(3)
NOT NULL, DEFAULT 'RWF'
ISO 4217 currency code
exchange_rate
DECIMAL(18,6)
NOT NULL, DEFAULT 1
Rate to base currency
status
ENUM
NOT NULL
posted | reversed | void
posted_by
UUID
NOT NULL, FK users
User or system that posted
posted_at
TIMESTAMPTZ
NOT NULL
Exact time of posting (UTC)
period_id
UUID / INT
NOT NULL, FK periods
Accounting period (for period lock)
reversal_of_id
UUID
NULLABLE, FK self
Set if this entry reverses another
tax_id
UUID
NULLABLE, FK tax_rates
Applied tax rate if any
notes
TEXT
NULLABLE
Internal notes (not on reports)
created_at
TIMESTAMPTZ
NOT NULL, DEFAULT NOW()
Audit timestamp
updated_at
TIMESTAMPTZ
NOT NULL
Last modification timestamp

## 3.2  journal_entry_lines table

One row per debit or credit line. Every journal_entry must have a minimum of 2 lines. Lines are immutable once posted — never UPDATE a posted line.

Field
Type
Constraints
Description
id
UUID / BIGINT
PK, NOT NULL
Unique line ID
journal_entry_id
UUID
NOT NULL, FK, INDEX
Parent journal entry
account_id
UUID
NOT NULL, FK chart_of_accounts
Ledger account to post to
dr_amount
DECIMAL(18,2)
NOT NULL, DEFAULT 0
Debit amount (0 if credit line)
cr_amount
DECIMAL(18,2)
NOT NULL, DEFAULT 0
Credit amount (0 if debit line)
description
VARCHAR(255)
NULLABLE
Line-level detail
entity_type
VARCHAR(50)
NULLABLE
supplier | customer | warehouse
entity_id
UUID
NULLABLE, INDEX
FK to supplier/customer/etc
tax_amount
DECIMAL(18,2)
NOT NULL, DEFAULT 0
Tax portion of this line
reconciled
BOOLEAN
NOT NULL, DEFAULT FALSE
Bank reconciliation flag
created_at
TIMESTAMPTZ
NOT NULL, DEFAULT NOW()
Audit timestamp

DATABASE CONSTRAINT (mandatory): ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_dr_or_cr CHECK (dr_amount = 0 OR cr_amount = 0) — a line can never have both a DR and CR amount simultaneously.

DATABASE CONSTRAINT (mandatory): Add a CHECK constraint or trigger at DB level that validates SUM(dr_amount) = SUM(cr_amount) per journal_entry_id on every INSERT. This is the last line of defense.

## 3.3  chart_of_accounts table

All accounts that journal lines can post to. This must be seeded before any transactions can be processed.

Field
Type
Constraints
Description
id
UUID
PK, NOT NULL
Account ID
code
VARCHAR(20)
UNIQUE, NOT NULL
E.g. 1100, 4000, 5000
name
VARCHAR(150)
NOT NULL
E.g. Inventory — Finished Goods
type
ENUM
NOT NULL
asset | liability | equity | revenue | expense
sub_type
VARCHAR(50)
NOT NULL
inventory | cash | ar | ap | cogs | ...
normal_balance
ENUM
NOT NULL
debit | credit
parent_id
UUID
NULLABLE, FK self
For hierarchical COA grouping
is_active
BOOLEAN
NOT NULL, DEFAULT TRUE
Inactive accounts cannot be posted to
allow_direct_posting
BOOLEAN
NOT NULL, DEFAULT TRUE
FALSE for header/group accounts
currency_code
CHAR(3)
NULLABLE
NULL = all currencies allowed

## 3.4  Minimum Chart of Accounts — Seed Data

These accounts must be created on system initialisation. Account codes follow the standard numbering convention: 1xxx = Assets, 2xxx = Liabilities, 3xxx = Equity, 4xxx = Revenue, 5xxx = COGS, 6xxx = Expenses.

Code
Account Name
Type
Sub-type
Normal
1100
Cash at Bank
asset
cash
Debit
1110
Petty Cash
asset
cash
Debit
1200
Accounts Receivable
asset
ar
Debit
1300
Inventory — Finished Goods
asset
inventory
Debit
1310
Inventory — Raw Materials
asset
inventory
Debit
1400
Prepaid Expenses
asset
prepaid
Debit
1500
Fixed Assets
asset
fixed_asset
Debit
1510
Accum. Depreciation
asset
contra_asset
Credit
2100
Accounts Payable
liability
ap
Credit
2200
VAT / Tax Payable
liability
tax
Credit
2300
Accrued Liabilities
liability
accrual
Credit
2400
Short-term Loans
liability
loan
Credit
3100
Share Capital
equity
capital
Credit
3200
Retained Earnings
equity
retained
Credit
4100
Sales Revenue
revenue
sales
Credit
4200
Other Income
revenue
other
Credit
5100
Cost of Goods Sold
expense
cogs
Debit
5200
Inventory Adjustments
expense
inv_adj
Debit
6100
Salaries & Wages
expense
payroll
Debit
6200
Rent & Utilities
expense
opex
Debit
6900
Bank Charges
expense
opex
Debit

# 4. Transaction-to-Journal Mapping

This is the core mapping table. For each business event (source_type), the system must auto-generate the exact DR/CR entries listed. These are not suggestions — they are the required entries. Any deviation must be approved by the product owner.

## 4.1  Purchases (Purchase Order Received / GRN Posted)

Triggered when: goods are received against a Purchase Order and a Goods Received Note (GRN) is confirmed. The supplier invoice may or may not arrive simultaneously — use Accounts Payable regardless.

Entry
Account
DR / CR
Line 1
1300 — Inventory (Finished Goods or Raw Materials)
DR  |  Purchase cost excl. tax
Line 2
2200 — VAT / Tax Payable (Input VAT)
DR  |  Tax amount (if VAT-registered)
Line 3
2100 — Accounts Payable
CR  |  Total invoice amount (incl. tax)

- narration format: "Purchase - [Supplier Name] - PO#[PO Number]"
- source_type value: 'purchase_order'
- source_id: the purchase_order.id that triggered this GRN
- The inventory account used must match the product's category (finished goods vs raw materials)

## 4.2  Purchase Returns

Triggered when: a supplier credit note is received or goods are returned to the supplier before the invoice is paid. This is the exact reversal of 4.1.

Entry
Account
DR / CR
Line 1
2100 — Accounts Payable
DR  |  Total credit note value (incl. tax)
Line 2
2200 — VAT / Tax Payable (Input VAT)
CR  |  Tax amount reversed
Line 3
1300 — Inventory
CR  |  Cost of returned goods excl. tax

- narration format: "Purchase Return - [Supplier Name] - REF#[Return Ref]"
- source_type value: 'purchase_return'

## 4.3  Sales Invoice

Triggered when: a sales invoice is confirmed/posted. This is a DUAL posting — two separate journal entries must be created atomically in the same database transaction: one for revenue recognition and one for cost recognition.

Entry A — Revenue Recognition

Entry
Account
DR / CR
Line 1
1200 — Accounts Receivable
DR  |  Total invoice amount (incl. tax)
Line 2
2200 — VAT / Tax Payable (Output VAT)
CR  |  Tax amount
Line 3
4100 — Sales Revenue
CR  |  Net sale amount excl. tax

Entry B — Cost of Goods Sold (COGS)

Entry
Account
DR / CR
Line 1
5100 — Cost of Goods Sold
DR  |  Cost of inventory dispatched
Line 2
1300 — Inventory
CR  |  Cost of inventory dispatched

CRITICAL: Both Entry A and Entry B must be committed atomically. If either fails, both must be rolled back. The COGS amount is the inventory cost at time of sale (FIFO or WAC per system config) — it is NOT the sale price.

- narration format (Entry A): "Sales Invoice - [Customer Name] - INV#[Invoice Number]"
- narration format (Entry B): "COGS - [Customer Name] - INV#[Invoice Number]"
- source_type value: 'sales_invoice' for both entries

## 4.4  Credit Notes (Sales Return)

Triggered when: a credit note is issued to a customer for goods returned. Exact reversal of 4.3 — both entries must be created atomically.

Entry A — Reverse Revenue

Entry
Account
DR / CR
Line 1
4100 — Sales Revenue
DR  |  Net amount excl. tax
Line 2
2200 — VAT / Tax Payable
DR  |  Tax amount reversed
Line 3
1200 — Accounts Receivable
CR  |  Total credit note amount

Entry B — Reverse COGS (return goods to inventory)

Entry
Account
DR / CR
Line 1
1300 — Inventory
DR  |  Original cost of returned goods
Line 2
5100 — Cost of Goods Sold
CR  |  Original cost of returned goods

- source_type value: 'credit_note'

## 4.5  Stock Transfer (Warehouse to Warehouse)

Triggered when: stock is moved from one warehouse/location to another. This is a balance sheet movement only — no P&L impact. If warehouses are tracked as separate sub-accounts within account 1300, use those. Otherwise use the main inventory account for both lines.

Entry
Account
DR / CR
Line 1
1300 — Inventory [Destination Warehouse]
DR  |  Transfer cost value
Line 2
1300 — Inventory [Source Warehouse]
CR  |  Transfer cost value

- narration format: "Stock Transfer - [Product] - from [WH-A] to [WH-B]"
- source_type value: 'stock_transfer'
- If a single inventory account is used (no sub-accounts per warehouse), this entry produces matching DR/CR on the same account — this is valid and must still be posted for audit trail purposes

## 4.6  Stock Audit / Inventory Count Adjustment

Triggered when: a physical stock count reveals a variance (more or fewer units than the system shows). The adjustment entry records the difference.

Positive Variance (found more stock than system)

Entry
Account
DR / CR
Line 1
1300 — Inventory
DR  |  Value of surplus units at cost
Line 2
5200 — Inventory Adjustments
CR  |  Value of surplus units at cost

Negative Variance (stock shortfall / shrinkage)

Entry
Account
DR / CR
Line 1
5200 — Inventory Adjustments
DR  |  Value of missing units at cost
Line 2
1300 — Inventory
CR  |  Value of missing units at cost

- source_type value: 'stock_audit'
- The per-unit cost used must be the system's current cost at time of audit (FIFO lot cost or WAC)

## 4.7  Additional source_type Reference

These additional transaction types must also produce auto-posted journal entries in later implementation phases. Document them now so the schema is ready:

source_type
Triggered by
DR
CR
bank_payment
AP Payment run
2100 Accounts Payable
1100 Cash at Bank
bank_receipt
AR Customer payment
1100 Cash at Bank
1200 Accounts Receivable
payroll_run
Payroll processed
6100 Salaries & Wages
1100 Cash + 2200 Tax
depreciation
Month-end depreciation
6xxx Depreciation Exp.
1510 Accum. Depreciation
recurring_invoice
Subscription auto-post
1200 Accounts Receivable
4100 Sales Revenue

# 5. Core Business Logic & Rules

## 5.1  Auto-Posting Architecture

The journal engine must be implemented as a service (JournalService) that is called from within a database transaction at the point the source event is committed. It must never be called from a background job or queue for the primary posting — real-time atomicity is required.

- Source event occurs (e.g. Purchase Order status changes to 'received')
- Database transaction opens
- Source record is saved (e.g. purchase_orders row updated)
- JournalService.post(source_type, source_id, data) is called
- JournalService builds the DR/CR entry lines from Section 4 mapping
- JournalService validates: SUM(DR) === SUM(CR) — throw error if not
- Journal entry and lines are inserted in the same transaction
- Transaction commits — source record and journal entry are committed atomically
- If any step fails, entire transaction rolls back — no orphaned entries

## 5.2  Idempotency

The system must prevent duplicate journal entries for the same source event. Implement a UNIQUE constraint on (source_type, source_id) in the journal_entries table. If JournalService.post() is called twice for the same source, it must detect the duplicate and return the existing entry rather than creating a second one.

Never post two journal entries for the same source_type + source_id combination. This can happen if a webhook fires twice or a user double-clicks. Use INSERT ... ON CONFLICT DO NOTHING or an explicit check before inserting.

## 5.3  Immutability of Posted Entries

Once a journal entry has status = 'posted', neither the entry nor its lines may be edited or deleted. This is a fundamental accounting principle (audit trail integrity).

- Implement a DB-level trigger that prevents UPDATE or DELETE on journal_entries where status = 'posted'
- Implement the same trigger on journal_entry_lines
- If a transaction needs to be corrected, a reversal entry must be created (see Section 5.4)

## 5.4  Reversals

When a posted transaction is cancelled or corrected, the system must create a reversal journal entry — not delete or edit the original. A reversal is a new journal entry with all DR and CR amounts swapped.

- Set the new entry's reversal_of_id to the original entry's id
- Set the original entry's status to 'reversed'
- Both operations must happen atomically
- The reversal entry must carry the same source_type and a new reference_no (e.g. JE-REV-2025-00001)
- narration format: "Reversal of [original narration]"

## 5.5  Period Locking

Each journal entry must be assigned to an accounting period (period_id). Once a period is locked (closed), no new entries may be posted to it and no existing entries may be reversed within it. The system must enforce this at the service layer.

Before posting any journal entry, check: is the target period open? If not, throw a PeriodClosedError and abort the transaction. Never bypass this check.

## 5.6  Reference Number Generation

Reference numbers must be unique, sequential, and human-readable. Use this format:

- Journal entries: JE-YYYY-NNNNN (e.g. JE-2025-00001)
- Reversal entries: JE-REV-YYYY-NNNNN
- Numbers must be sequential per year and must not have gaps (use a DB sequence, not MAX+1)
- The sequence must be padded to 5 digits minimum

# 6. API Endpoints

These endpoints must be implemented. All endpoints require authentication. All responses use JSON. All amounts are strings (not floats) to prevent precision loss.

## 6.1  POST  /api/journal-entries

Manual journal entry creation (for accountant use only — system-generated entries go through JournalService directly, not this endpoint). Restricted to roles: accountant, admin.

Field
Type
Required
Notes
entry_date
string (ISO date)
Yes
YYYY-MM-DD format
narration
string
Yes
Max 500 chars
lines
array
Yes
Min 2 items, see below
lines[].account_id
UUID
Yes
Must exist and be active
lines[].dr_amount
string decimal
Yes*
*One of dr or cr must be > 0
lines[].cr_amount
string decimal
Yes*
*One of dr or cr must be > 0
lines[].description
string
No
Max 255 chars
currency_code
string
No
Default: company base currency

## 6.2  GET  /api/journal-entries

List journal entries with filtering. Supports pagination.

- Query params: date_from, date_to, source_type, account_id, status, page, per_page
- Default sort: entry_date DESC, reference_no DESC
- Response includes total_count for pagination

## 6.3  GET  /api/journal-entries/:id

Get a single journal entry with all its lines and associated metadata.

## 6.4  POST  /api/journal-entries/:id/reverse

Reverse a posted journal entry. Creates a new reversal entry and marks the original as reversed. Body: { reason: string (required), reversal_date: string (required) }. Roles: accountant, admin only.

## 6.5  GET  /api/journal-entries/validate

Dry-run endpoint — validates a proposed entry without posting it. Returns the entry as it would be created plus any validation errors. Useful for UI preview before confirmation.

# 7. Validation Rules & Error Handling

Condition
Error Code
HTTP Status
DR total != CR total
JOURNAL_UNBALANCED
422
Entry has fewer than 2 lines
JOURNAL_MIN_LINES
422
Account does not exist
ACCOUNT_NOT_FOUND
422
Account is inactive
ACCOUNT_INACTIVE
422
Account has allow_direct_posting = false
ACCOUNT_NO_POSTING
422
Period is closed/locked
PERIOD_CLOSED
409
Duplicate source_type + source_id
JOURNAL_DUPLICATE
409
Attempting to edit a posted entry
JOURNAL_IMMUTABLE
409
Amount <= 0 on a line
AMOUNT_INVALID
422
Line has both DR and CR > 0
LINE_BOTH_DR_CR
422
Inventory cost lookup fails
COST_LOOKUP_FAILED
500

# 8. Audit Trail & Security

- Every journal entry must record: who posted it (posted_by), when (posted_at), from what source (source_type + source_id)
- All API calls to this module must be logged in a separate audit_log table: user_id, action, entity_type, entity_id, timestamp, ip_address, changes (JSON diff)
- Only roles: accountant and admin may create manual journal entries via the API
- System-generated entries (from JournalService) are posted as the system user (a reserved user_id)
- Reversals require an additional reason field and can only be performed by accountant or admin
- Read access: any authenticated user may read journal entries but never modify them
- Implement row-level security if multi-company/multi-tenant: entries must be filtered by company_id on every query

# 9. Acceptance Tests (Definition of Done)

This module is NOT complete until every test below passes. Do not move to Module 2 (General Ledger) until all tests are green.

## Unit Tests — JournalService

- Test: posting a purchase order creates 3 lines (DR Inventory, DR VAT, CR AP) and SUM(DR) = SUM(CR)
- Test: posting a sales invoice creates 2 journal entries atomically (revenue + COGS)
- Test: posting a stock audit with negative variance creates DR Inv Adjustment, CR Inventory
- Test: duplicate call with same source_type + source_id returns existing entry, does not create a second
- Test: an unbalanced entry (DR != CR) throws JOURNAL_UNBALANCED and does not persist
- Test: posting to a locked period throws PERIOD_CLOSED
- Test: reversal creates a new entry with swapped DR/CR and sets original status to 'reversed'

## Integration Tests — API

- POST /api/journal-entries with valid payload returns 201 and a full journal entry object
- GET /api/journal-entries returns paginated list filtered by date range
- POST /api/journal-entries/:id/reverse returns 200 and reversal entry; original status = 'reversed'
- Attempting to POST a manual entry as a non-accountant role returns 403
- Attempting to edit a posted journal entry via any API endpoint returns 409 JOURNAL_IMMUTABLE

## End-to-End Tests

- Create a Purchase Order, receive goods, verify journal entry is auto-posted and inventory account balance increases
- Create a Sales Invoice, verify two journal entries: AR/Revenue entry and COGS/Inventory entry
- Run a stock audit with a negative variance, verify Inventory account decreases and Inventory Adjustments expense increases
- Verify that at any point: SUM of all DR lines across all posted entries = SUM of all CR lines

The final test (#4 above) is the master health check. Build a /api/accounting/health endpoint that runs this check and returns the result. It should be called in CI on every deploy.

# 10. Questions Before Starting

Before writing code, confirm the following with the product owner:

- Which inventory valuation method? (FIFO recommended — confirm)
- Base currency for the company? (This is immutable once set)
- Is the system multi-company / multi-tenant? (Affects schema — company_id on all tables)
- Is VAT applicable? (If not, VAT lines in Sections 4.1–4.4 can be omitted initially)
- Which database? (PostgreSQL recommended for ACID compliance and row-level triggers)
- Which tech stack / ORM? (Affects how JournalService and transactions are implemented)

Do not assume answers to any of the above. Wrong assumptions here create schema migrations mid-project that are very costly to fix. Confirm first, then code.

End of Module 1 Specification
Next: Module 2 — General Ledger & Account Balances