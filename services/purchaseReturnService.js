const DEFAULT_ACCOUNTS = require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS;

// default dependencies
let JournalService = require('./journalService');
let InventoryService = require('./inventoryService');
let GoodsReceivedNote = require('../models/GoodsReceivedNote');

function __setDependencies(deps = {}) {
  if (deps.JournalService) JournalService = deps.JournalService;
  if (deps.InventoryService) InventoryService = deps.InventoryService;
  if (deps.GoodsReceivedNote) GoodsReceivedNote = deps.GoodsReceivedNote;
}

async function createPurchaseReturn(pr, opts = {}) {
  // pr: { _id, company, grnId, lines: [{ grnLine, product, qtyReturned, unitCost }] }
  if (!pr || !pr.lines) throw new Error('invalid payload');

  // Validation: ensure not returning more than available if grn provided in opts
  if (opts.grn) {
    for (const line of pr.lines) {
      const gline = (opts.grn.lines || []).find(l => String(l._id) === String(line.grnLine));
      if (gline) {
        const available = (gline.qtyReceived || 0) - (gline.qtyReturned || 0);
        if (Number(line.qtyReturned) > available) throw new Error('returned qty exceeds available');
      }
    }
  }

  // Apply stock adjustments
  const adjusted = [];
  for (const l of pr.lines) {
    if (InventoryService && InventoryService.adjustLot) {
      const res = await InventoryService.adjustLot(l.grnLine || l.lotId || l.grnLine, { quantity: -Math.abs(l.qtyReturned) }, opts.session || null);
      adjusted.push(res);
    }
  }

  // Build reversal journal lines: reverse the GRN JE (debit/credit swapped)
  const amt = pr.lines.reduce((s, l) => s + (Number(l.unitCost || 0) * Number(l.qtyReturned || 0)), 0);
  const lines = [ { type: 'debit', account: DEFAULT_ACCOUNTS.accountsPayable, amount: amt }, { type: 'credit', account: DEFAULT_ACCOUNTS.inventory, amount: amt } ];

  // Prepare journal entry options. Use atomic API if available, otherwise fall back to legacy createEntry call for tests
  const userId = (opts.user && opts.user.id) || null;
  const companyId = pr.company || (opts.company || null);

  const atomicEntry = {
    date: new Date(),
    description: `Purchase Return ${pr._id}`,
    sourceType: 'purchase_return',
    sourceId: pr._id,
    sourceReference: pr._id,
    lines: []
  };

  // Build lines for atomic API (debit/credit format)
  atomicEntry.lines.push({ accountCode: DEFAULT_ACCOUNTS.accountsPayable, debit: amt, credit: 0, description: `Purchase Return ${pr._id}` });
  atomicEntry.lines.push({ accountCode: DEFAULT_ACCOUNTS.inventory, debit: 0, credit: amt, description: `Purchase Return ${pr._id}` });

  let je;
  if (JournalService.createEntriesAtomic) {
    const created = await JournalService.createEntriesAtomic(companyId, userId, [atomicEntry], { session: opts.session || null });
    je = created && created.length ? created[0] : null;
  } else {
    // Legacy callers/tests expect createEntry to be called with a single object containing 'lines' with type/amount
    const legacyLines = [ { type: 'debit', account: DEFAULT_ACCOUNTS.accountsPayable, amount: amt }, { type: 'credit', account: DEFAULT_ACCOUNTS.inventory, amount: amt } ];
    je = await JournalService.createEntry({ company: companyId, userId, date: new Date(), description: `Purchase Return ${pr._id}`, lines: legacyLines, totalDebit: amt, totalCredit: amt, session: opts.session || null });
  }

  // mark pr confirmed
  pr.journalEntryId = je && (je._id || je.id) ? (je._id || je.id) : null;
  pr.status = 'confirmed';
  return pr;
}

module.exports = { createPurchaseReturn, __setDependencies };
