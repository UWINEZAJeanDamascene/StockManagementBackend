/**
 * 7.1 MongoDB indexes audit — schema indexes + explain IXSCAN where supported (mongod 4+ / memory server)
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const JournalEntry = require('../../models/JournalEntry');
const JournalEntryLine = require('../../models/JournalEntryLine');
const Invoice = require('../../models/Invoice');
const StockLevel = require('../../models/StockLevel');
const StockMovement = require('../../models/StockMovement');
const PurchaseOrder = require('../../models/PurchaseOrder');
const BudgetLine = require('../../models/BudgetLine');
const RefreshToken = require('../../models/RefreshToken');
const Sequence = require('../../models/Sequence');
const AuditLog = require('../../models/AuditLog');
const UserSession = require('../../models/UserSession');
const Company = require('../../models/Company');
const User = require('../../models/User');

const THIRTY_DAYS_SEC = 60 * 60 * 24 * 30;
const SEVEN_YEARS_SEC = 60 * 60 * 24 * 365 * 7;

let mongoServer;

function hasIndexKey(indexes, keyObj) {
  const want = JSON.stringify(keyObj);
  return indexes.some((ix) => ix.name !== '_id_' && JSON.stringify(ix.key) === want);
}

function findTtlIndex(indexes, fieldName) {
  return indexes.find(
    (ix) => ix.key && ix.key[fieldName] === 1 && typeof ix.expireAfterSeconds === 'number',
  );
}

function stageUsesIxscan(stage) {
  if (!stage) return false;
  if (stage.stage === 'IXSCAN') return true;
  if (stage.inputStage) return stageUsesIxscan(stage.inputStage);
  if (Array.isArray(stage.inputStages)) {
    return stage.inputStages.some((s) => stageUsesIxscan(s));
  }
  return false;
}

function explainHasIxscan(explain) {
  const stats = explain.executionStats || explain;
  if (stats.executionStages) return stageUsesIxscan(stats.executionStages);
  if (explain.queryPlanner?.winningPlan) return stageUsesIxscan(explain.queryPlanner.winningPlan);
  return false;
}

async function syncAll() {
  const models = [
    JournalEntry,
    JournalEntryLine,
    Invoice,
    StockLevel,
    StockMovement,
    PurchaseOrder,
    BudgetLine,
    RefreshToken,
    Sequence,
    AuditLog,
    UserSession,
    Company,
    User,
  ];
  for (const M of models) {
    await M.syncIndexes();
  }
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await syncAll();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('7.1 MongoDB Indexes Audit', () => {
  describe('journal_entries indexes', () => {
    it('has index on company_id', async () => {
      const ix = await JournalEntry.collection.indexes();
      expect(hasIndexKey(ix, { company: 1 })).toBe(true);
    });

    it('has compound index on company_id + status', async () => {
      const ix = await JournalEntry.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1 })).toBe(true);
    });

    it('has compound index on company_id + status + entry_date', async () => {
      const ix = await JournalEntry.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1, date: 1 })).toBe(true);
    });

    it('has compound index on company_id + source_type + entry_date', async () => {
      const ix = await JournalEntry.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, sourceType: 1, date: 1 })).toBe(true);
    });

    it('query by company_id and status uses IXSCAN not COLLSCAN', async () => {
      const company = new mongoose.Types.ObjectId();
      const user = new mongoose.Types.ObjectId();
      await JournalEntry.create({
        company,
        entryNumber: 'JE-1',
        date: new Date(),
        description: 't',
        status: 'draft',
        createdBy: user,
        lines: [
          { accountCode: '1000', accountName: 'Cash', debit: 1, credit: 0 },
          { accountCode: '2000', accountName: 'Equity', debit: 0, credit: 1 },
        ],
      });
      const ex = await JournalEntry.collection
        .find({ company, status: 'draft' })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });

    it('query by company_id and entry_date range uses IXSCAN', async () => {
      const company = new mongoose.Types.ObjectId();
      const user = new mongoose.Types.ObjectId();
      await JournalEntry.create({
        company,
        entryNumber: 'JE-2',
        date: new Date('2025-06-01'),
        description: 't',
        status: 'posted',
        createdBy: user,
        lines: [
          { accountCode: '2000', accountName: 'AP', debit: 1, credit: 0 },
          { accountCode: '3000', accountName: 'Revenue', debit: 0, credit: 1 },
        ],
      });
      const ex = await JournalEntry.collection
        .find({
          company,
          date: { $gte: new Date('2025-01-01'), $lte: new Date('2025-12-31') },
        })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('journal_entry_lines indexes', () => {
    it('has compound index on company_id + account_id', async () => {
      const ix = await JournalEntryLine.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, account_id: 1 })).toBe(true);
    });

    it('has compound index on company_id + journal_entry_id', async () => {
      const ix = await JournalEntryLine.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, journal_entry_id: 1 })).toBe(true);
    });

    it('query by company_id and account_id uses IXSCAN not COLLSCAN', async () => {
      const company_id = new mongoose.Types.ObjectId();
      const journal_entry_id = new mongoose.Types.ObjectId();
      const account_id = new mongoose.Types.ObjectId();
      await JournalEntryLine.create({ company_id, journal_entry_id, account_id, debit: 1, credit: 0 });
      const ex = await JournalEntryLine.collection
        .find({ company_id, account_id })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('sales_invoices indexes', () => {
    it('has compound index on company_id + status', async () => {
      const ix = await Invoice.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1 })).toBe(true);
    });

    it('has compound index on company_id + status + due_date', async () => {
      const ix = await Invoice.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1, dueDate: 1 })).toBe(true);
    });

    it('has compound index on company_id + invoice_date', async () => {
      const ix = await Invoice.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, invoiceDate: 1 })).toBe(true);
    });

    it('has compound index on company_id + client_id + status', async () => {
      const ix = await Invoice.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, client: 1, status: 1 })).toBe(true);
    });

    it('overdue AR query uses IXSCAN not COLLSCAN', async () => {
      const company = new mongoose.Types.ObjectId();
      const client = new mongoose.Types.ObjectId();
      await Invoice.create({
        company,
        client,
        dueDate: new Date('2020-01-01'),
        invoiceDate: new Date('2019-12-01'),
        status: 'confirmed',
        lines: [
          {
            product: new mongoose.Types.ObjectId(),
            qty: 1,
            unitPrice: 10,
          },
        ],
      });
      const ex = await Invoice.collection
        .find({
          company,
          status: { $in: ['confirmed', 'partially_paid'] },
          dueDate: { $lt: new Date() },
        })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('stock_levels indexes', () => {
    it('has unique compound index on company_id + product_id + warehouse_id', async () => {
      const ix = await StockLevel.collection.indexes();
      expect(
        ix.some(
          (i) =>
            JSON.stringify(i.key) === JSON.stringify({ company_id: 1, product_id: 1, warehouse_id: 1 }) &&
            i.unique === true,
        ),
      ).toBe(true);
    });

    it('unique index prevents duplicate product-warehouse combination per company', async () => {
      const company_id = new mongoose.Types.ObjectId();
      const product_id = new mongoose.Types.ObjectId();
      const warehouse_id = new mongoose.Types.ObjectId();
      await StockLevel.create({ company_id, product_id, warehouse_id, qty_on_hand: 1 });
      await expect(
        StockLevel.create({ company_id, product_id, warehouse_id, qty_on_hand: 2 }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('has index on company_id + qty_on_hand', async () => {
      const ix = await StockLevel.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, qty_on_hand: 1 })).toBe(true);
    });

    it('has index on company_id + last_movement_at', async () => {
      const ix = await StockLevel.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, last_movement_at: 1 })).toBe(true);
    });

    it('low stock query uses IXSCAN not COLLSCAN', async () => {
      const company_id = new mongoose.Types.ObjectId();
      const product_id = new mongoose.Types.ObjectId();
      const warehouse_id = new mongoose.Types.ObjectId();
      await StockLevel.create({
        company_id,
        product_id,
        warehouse_id,
        qty_on_hand: 2,
        last_movement_at: new Date(),
      });
      const ex = await StockLevel.collection
        .find({ company_id, qty_on_hand: { $lte: 5 } })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('stock_movements indexes', () => {
    it('has compound index on company_id + movement_type + created_at', async () => {
      const ix = await StockMovement.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, type: 1, createdAt: -1 })).toBe(true);
    });

    it('has compound index on company_id + product_id + created_at', async () => {
      const ix = await StockMovement.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, product_id: 1, createdAt: -1 })).toBe(true);
    });

    it('dead stock query uses IXSCAN not COLLSCAN', async () => {
      const company_id = new mongoose.Types.ObjectId();
      const product_id = new mongoose.Types.ObjectId();
      await StockMovement.create({
        company_id,
        product_id,
        type: 'out',
        reason: 'sale',
        createdAt: new Date('2024-01-01'),
      });
      const ex = await StockMovement.collection
        .find({
          company_id,
          product_id,
          createdAt: { $lt: new Date('2025-01-01') },
        })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('purchase_orders indexes', () => {
    it('has compound index on company_id + status', async () => {
      const ix = await PurchaseOrder.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1 })).toBe(true);
    });

    it('has compound index on company_id + status + order_date', async () => {
      const ix = await PurchaseOrder.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, status: 1, orderDate: 1 })).toBe(true);
    });

    it('open POs query uses IXSCAN not COLLSCAN', async () => {
      const company = new mongoose.Types.ObjectId();
      const supplier = new mongoose.Types.ObjectId();
      const user = new mongoose.Types.ObjectId();
      await PurchaseOrder.create({
        company,
        referenceNo: 'PO-1',
        supplier,
        status: 'approved',
        orderDate: new Date(),
        createdBy: user,
        lines: [{ product: new mongoose.Types.ObjectId(), qtyOrdered: 1 }],
      });
      const ex = await PurchaseOrder.collection
        .find({ company, status: 'approved' })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('budget_lines indexes', () => {
    it('has compound index on company_id + budget_id + period_year + period_month', async () => {
      const ix = await BudgetLine.collection.indexes();
      expect(
        hasIndexKey(ix, { company_id: 1, budget_id: 1, period_year: 1, period_month: 1 }),
      ).toBe(true);
    });

    it('budget vs actual query uses IXSCAN not COLLSCAN', async () => {
      const company_id = new mongoose.Types.ObjectId();
      const budget_id = new mongoose.Types.ObjectId();
      const account_id = new mongoose.Types.ObjectId();
      await BudgetLine.create({
        company_id,
        budget_id,
        account_id,
        period_year: 2025,
        period_month: 3,
        budgeted_amount: mongoose.Types.Decimal128.fromString('100'),
      });
      const ex = await BudgetLine.collection
        .find({ company_id, budget_id, period_year: 2025, period_month: 3 })
        .explain('executionStats');
      expect(explainHasIxscan(ex)).toBe(true);
    });
  });

  describe('refresh_tokens indexes', () => {
    it('has unique index on token_hash', async () => {
      const ix = await RefreshToken.collection.indexes();
      const u = ix.find((i) => i.unique && i.key && i.key.token_hash === 1);
      expect(u).toBeDefined();
    });

    it('has TTL index on expires_at that auto-deletes expired tokens', async () => {
      const ix = await RefreshToken.collection.indexes();
      const ttl = findTtlIndex(ix, 'expires_at');
      expect(ttl).toBeDefined();
      expect(ttl.expireAfterSeconds).toBe(0);
    });

    it('TTL expireAfterSeconds equals 30 days in seconds', async () => {
      const ix = await RefreshToken.collection.indexes();
      const ttl = ix.find(
        (i) => i.key && i.key.createdAt === 1 && i.expireAfterSeconds === THIRTY_DAYS_SEC,
      );
      expect(ttl).toBeDefined();
    });

    it('has compound index on user_id + is_revoked', async () => {
      const ix = await RefreshToken.collection.indexes();
      expect(hasIndexKey(ix, { user_id: 1, is_revoked: 1 })).toBe(true);
    });
  });

  describe('sequences indexes', () => {
    it('has unique compound index on company_id + prefix + year', async () => {
      const ix = await Sequence.collection.indexes();
      expect(hasIndexKey(ix, { company: 1, name: 1, year: 1 })).toBe(true);
      const row = ix.find((i) => JSON.stringify(i.key) === JSON.stringify({ company: 1, name: 1, year: 1 }));
      expect(row.unique).toBe(true);
    });

    it('duplicate sequence key throws and does not create duplicate', async () => {
      const company = new mongoose.Types.ObjectId();
      await Sequence.create({ company, name: 'INV', year: 2025, seq: 1 });
      await expect(Sequence.create({ company, name: 'INV', year: 2025, seq: 2 })).rejects.toMatchObject({
        code: 11000,
      });
      expect(await Sequence.countDocuments({ company, name: 'INV', year: 2025 })).toBe(1);
    });
  });

  describe('audit_logs indexes', () => {
    it('has compound index on company_id + createdAt descending', async () => {
      const ix = await AuditLog.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, createdAt: -1 })).toBe(true);
    });

    it('has compound index on company_id + user_id + createdAt', async () => {
      const ix = await AuditLog.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, user_id: 1, createdAt: -1 })).toBe(true);
    });

    it('has compound index on company_id + entity_type + entity_id', async () => {
      const ix = await AuditLog.collection.indexes();
      expect(hasIndexKey(ix, { company_id: 1, entity_type: 1, entity_id: 1 })).toBe(true);
    });

    it('has TTL index on createdAt for 7-year retention', async () => {
      const ix = await AuditLog.collection.indexes();
      const ttl = findTtlIndex(ix, 'createdAt');
      expect(ttl).toBeDefined();
    });

    it('TTL expireAfterSeconds equals 7 years in seconds', async () => {
      const ix = await AuditLog.collection.indexes();
      const ttl = ix.find(
        (i) => i.key && i.key.createdAt === 1 && i.expireAfterSeconds === SEVEN_YEARS_SEC,
      );
      expect(ttl).toBeDefined();
    });
  });

  describe('user_sessions indexes', () => {
    it('has compound index on user_id + is_active', async () => {
      const ix = await UserSession.collection.indexes();
      expect(hasIndexKey(ix, { user_id: 1, is_active: 1 })).toBe(true);
    });

    it('has TTL index on last_active_at for 30-day session expiry', async () => {
      const ix = await UserSession.collection.indexes();
      const ttl = findTtlIndex(ix, 'last_active_at');
      expect(ttl).toBeDefined();
      expect(ttl.expireAfterSeconds).toBe(THIRTY_DAYS_SEC);
    });
  });
});
