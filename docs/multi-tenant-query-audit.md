# Multi-tenant Query Audit — Missing `company` Predicate

Summary
-------
- Purpose: list all backend queries found that appear to lack an explicit `company` (tenant) filter. Each item should be reviewed and either (a) constrained to include `company: companyId`, or (b) validated that the code performs an ownership check immediately after fetch.
- Scope: only queries that do NOT include a `company` predicate were included. Calls that already include `company` were skipped.

High-risk: `find(...)` or `findOne(...)` without `company`
-----------------------------------------------------
- [models/APPaymentAllocation.js](models/APPaymentAllocation.js#L56): `return this.find({ payment: paymentId })`
- [models/APPaymentAllocation.js](models/APPaymentAllocation.js#L63): `return this.find({ grn: grnId })`
- [services/apService.js](services/apService.js#L193): `const allocations = await APPaymentAllocation.find({ payment: payment._id });`
- [services/apService.js](services/apService.js#L336): `const allocations = await APPaymentAllocation.find({ payment: payment._id });`
- [services/apService.js](services/apService.js#L801): `const allocations = await APPaymentAllocation.find({ payment: paymentId })`
- [controllers/arController.js](controllers/arController.js#L175): `const allocations = await ARReceiptAllocation.find({ receipt: id })`
- [services/arService.js](services/arService.js#L134): `const allocations = await ARReceiptAllocation.find({ receipt: receipt._id });`
- [services/arService.js](services/arService.js#L304): `const allocations = await ARReceiptAllocation.find({ receipt: receipt._id });`
- [controllers/bankAccountController.js](controllers/bankAccountController.js#L871): `const existingStatements = await BankStatementLine.find({ bankAccount: account._id })`
- [controllers/pettyCashController.js](controllers/pettyCashController.js#L18): `const transactions = await PettyCashTransaction.find({ float: floatId })`
- [controllers/payableController.js](controllers/payableController.js#L782): `const existingSchedules = await PaymentSchedule.find({ purchase: purchase._id });`
- [services/stockTransferService.js](services/stockTransferService.js#L13): `const prods = await Product.find({ _id: { $in: productIds } });`
- [models/APPaymentAllocation.js](models/APPaymentAllocation.js#L56-L79): multiple `aggregate`/`find` usages inside model static methods which should be reviewed for company scoping.

Medium-risk: `findById(...)` usages (cannot include `company` directly)
---------------------------------------------------------------
Note: `findById(id)` cannot include a `company` filter in the call; these must be followed by an explicit check that the found document belongs to the current company (ownership validation). If that check is missing, replace with `findOne({ _id: id, company: companyId })`.

- [services/apService.js](services/apService.js#L101): `const grn = await GoodsReceivedNote.findById(alloc.grnId);`
- [services/apService.js](services/apService.js#L204): `const grn = await GoodsReceivedNote.findById(alloc.grn);`
- [services/apService.js](services/apService.js#L227): `const supplier = await Supplier.findById(payment.supplier);`
- [services/apService.js](services/apService.js#L231): `const bankAccount = await BankAccount.findById(payment.bankAccount);`
- [services/apService.js](services/apService.js#L444): `const grn = await GoodsReceivedNote.findById(grnId);`
- [services/apService.js](services/apService.js#L471): `const grn = await GoodsReceivedNote.findById(grnId);`
- [services/apService.js](services/apService.js#L497): `const grn = await GoodsReceivedNote.findById(grnId);`
- [services/arService.js](services/arService.js#L151): `const invoice = await Invoice.findById(alloc.invoice);`
- [services/arService.js](services/arService.js#L179): `const bankAcct = await BankAccount.findById(receipt.bankAccount);`
- [services/arService.js](services/arService.js#L195): `const client = await Client.findById(receipt.client);`
- [controllers/grnController.js](controllers/grnController.js#L244): `const product = await Product.findById(prodId).lean();`
- [controllers/grnController.js](controllers/grnController.js#L257): `const supplier = await Supplier.findById(po.supplier).lean();`
- [controllers/grnController.js](controllers/grnController.js#L326): `GoodsReceivedNote.findById(result._id)` in response payload — ensure payload is owned by the company.
- [controllers/fixedAssetController.js](controllers/fixedAssetController.js#L61): multiple `FixedAsset.findById(id)` calls — review for ownership checks.
- [controllers/bankAccountController.js](controllers/bankAccountController.js#L1815): `const je = await JournalEntry.findById(m.journalEntry).lean();`
- [controllers/bankAccountController.js](controllers/bankAccountController.js#L1900-L1901): `BankStatementLine.findById(...)`, `JournalEntry.findById(...)`
- [controllers/backupController.js](controllers/backupController.js#L152): `const backup = await Backup.findById(backupId);` (ensure company ownership)

Low-risk / Intentional global scans (do NOT change without business review)
----------------------------------------------------------------------
- [services/notificationScheduler.js](services/notificationScheduler.js#L1): uses `Company.find({})` to iterate all companies for scheduled jobs — intentional.
- [scripts/approveAllCompanies.js](scripts/approveAllCompanies.js#L24): `Company.find({ approvalStatus: 'pending' })` — administrative script.

Actionable Recommendations
--------------------------
1. For each `find(...)` or `findOne(...)` above, either add `company: companyId` to the query or add an immediate ownership check after fetching.
2. Replace `findById(id)` with `findOne({ _id: id, company: companyId })` where `companyId` is available in scope. If `findById` is used inside model methods, pass the company or perform ownership checks.
3. For model-level static methods (e.g., APPaymentAllocation), prefer accepting `companyId` as an argument and scoping queries accordingly.
4. Remove any cache key fallbacks that read `req.query.companyId` — require `req.company` (from auth middleware) instead.
5. Add a CI lint/test that flags DB queries that don't include tenant scoping.

How to triage
--------------
- Scan this file and open each linked file and line to confirm whether an ownership check exists after fetch. If not, implement the safe change and run tests.

If you want, I can (A) generate a CSV with every occurrence and code snippet, or (B) prepare PR patches that add `company` scoping to the highest-risk lines. Tell me which option to run next.

---
Generated by automated repo scan (March 20, 2026). Review before applying automated changes.
