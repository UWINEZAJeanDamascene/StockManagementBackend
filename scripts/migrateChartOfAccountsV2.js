/**
 * migrateChartOfAccountsV2.js
 *
 * Migration script — syncs the Chart of Accounts in MongoDB against the
 * canonical constants/chartOfAccounts.js definition for EVERY company.
 *
 * Safe for production: uses upsert / updateOne — never deletes posted accounts.
 *
 * What it does per company:
 *   1. INSERT  any account code that exists in constants but not yet in DB.
 *   2. UPDATE  name, subtype, normal_balance, allow_direct_posting for any
 *              account whose definition changed in constants (e.g. 5700
 *              'operating' → 'distribution').
 *   3. SKIP    account codes that already match — no writes needed.
 *
 * Subtype changes applied by this migration:
 *   5700  operating  → distribution   (Transport & Delivery)
 *   5850  operating  → distribution   (Marketing & Advertising)
 *   5250  operating  → other_expense  (Bad Debt Expense)
 *   6100  operating  → other_expense  (Other Expenses)
 *   5800  operating  → depreciation   (Depreciation Expense)
 *
 * New accounts added:
 *   1800  Accumulated Depreciation  (header, non-posting)
 *   2850  Deferred Revenue          (current liability, IFRS 15)
 *   4050  Service Revenue           (operating revenue)
 *
 * Usage:
 *   # Migrate ALL companies (dry-run first, then real):
 *   node scripts/migrateChartOfAccountsV2.js --dry-run
 *   node scripts/migrateChartOfAccountsV2.js
 *
 *   # Migrate ONE specific company:
 *   node scripts/migrateChartOfAccountsV2.js --company=<companyId>
 *
 *   # Dry-run for one company:
 *   node scripts/migrateChartOfAccountsV2.js --company=<companyId> --dry-run
 */

"use strict";

const mongoose = require("mongoose");
const dotenv   = require("dotenv");

dotenv.config();

// ── Single source of truth ────────────────────────────────────────────────────
const { CHART_OF_ACCOUNTS } = require("../constants/chartOfAccounts");

// ── Fields we compare and update when they drift ─────────────────────────────
const MUTABLE_FIELDS = ["name", "subtype", "normal_balance", "allow_direct_posting"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDbShape(code, entry, companyId) {
  return {
    company:              companyId,
    code:                 String(code),
    name:                 entry.name,
    type:                 entry.type,
    subtype:              entry.subtype || null,
    normal_balance:       entry.normalBalance,
    allow_direct_posting: entry.allowDirectPosting,
    isActive:             true,
  };
}

function isDrift(existing, canonical) {
  return (
    existing.name                 !== canonical.name                 ||
    (existing.subtype || null)    !== (canonical.subtype || null)     ||
    existing.normal_balance       !== canonical.normal_balance        ||
    existing.allow_direct_posting !== canonical.allow_direct_posting
  );
}

function pad(str, width) {
  return String(str).padEnd(width, " ");
}

// ── Per-company migration ─────────────────────────────────────────────────────

async function migrateCompany(ChartOfAccount, company, dryRun) {
  const companyId = company._id;
  const label     = `${company.name || "Unknown"} (${companyId})`;

  const existing = await ChartOfAccount.find({ company: companyId })
    .select("code name subtype normal_balance allow_direct_posting")
    .lean();

  const existingMap = new Map(existing.map((a) => [a.code, a]));

  const stats = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const changes = [];   // log for --dry-run output

  for (const [rawCode, entry] of Object.entries(CHART_OF_ACCOUNTS)) {
    const code = String(rawCode);
    const canonical = toDbShape(code, entry, companyId);
    const existing_  = existingMap.get(code);

    if (!existing_) {
      // ── INSERT: account missing from DB ───────────────────────────
      changes.push({ action: "INSERT", code, name: entry.name, detail: entry.subtype });
      if (!dryRun) {
        try {
          await ChartOfAccount.create({
            ...canonical,
            createdBy: null,
          });
          stats.inserted++;
        } catch (err) {
          if (err.code === 11000) {
            // Race condition / already inserted by concurrent run — skip
            stats.skipped++;
          } else {
            console.error(`   ❌  INSERT error for ${code}: ${err.message}`);
            stats.errors++;
          }
        }
      } else {
        stats.inserted++;
      }
    } else if (isDrift(existing_, canonical)) {
      // ── UPDATE: one or more fields changed ────────────────────────
      const changedFields = MUTABLE_FIELDS.filter((f) => {
        const existingVal  = existing_[f] !== undefined ? existing_[f] : null;
        const canonicalVal = canonical[f]  !== undefined ? canonical[f]  : null;
        return existingVal !== canonicalVal;
      });

      const detail = changedFields
        .map((f) => `${f}: ${existing_[f] ?? "null"} → ${canonical[f] ?? "null"}`)
        .join(" | ");

      changes.push({ action: "UPDATE", code, name: entry.name, detail });

      if (!dryRun) {
        try {
          await ChartOfAccount.updateOne(
            { _id: existing_._id },
            {
              $set: {
                name:                 canonical.name,
                subtype:              canonical.subtype,
                normal_balance:       canonical.normal_balance,
                allow_direct_posting: canonical.allow_direct_posting,
              },
            }
          );
          stats.updated++;
        } catch (err) {
          console.error(`   ❌  UPDATE error for ${code}: ${err.message}`);
          stats.errors++;
        }
      } else {
        stats.updated++;
      }
    } else {
      // ── SKIP: already up-to-date ───────────────────────────────────
      stats.skipped++;
    }
  }

  // ── Print per-company result ───────────────────────────────────────
  const total   = stats.inserted + stats.updated + stats.skipped;
  const touched = stats.inserted + stats.updated;

  if (touched === 0) {
    console.log(`  ✅  ${label}  — already up-to-date (${total} accounts)`);
    return stats;
  }

  console.log(`\n  📋  ${label}`);

  for (const c of changes) {
    const icon = c.action === "INSERT" ? "➕" : "✏️ ";
    console.log(
      `      ${icon}  ${pad(c.code, 6)}  ${pad(c.action, 7)}  ${pad(c.name, 40)}  ${c.detail || ""}`
    );
  }

  const dryLabel = dryRun ? " [DRY RUN — no writes]" : "";
  console.log(
    `      ─── inserted: ${stats.inserted}  updated: ${stats.updated}  skipped: ${stats.skipped}  errors: ${stats.errors}${dryLabel}`
  );

  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args       = process.argv.slice(2);
  const dryRun     = args.includes("--dry-run");
  const companyArg = args.find((a) => a.startsWith("--company="));
  const companyId  = companyArg ? companyArg.split("=")[1] : null;

  // ── Connect ────────────────────────────────────────────────────────
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/stock_tenancy";
  try {
    await mongoose.connect(uri, {
      useNewUrlParser:    true,
      useUnifiedTopology: true,
    });
    console.log("✅  MongoDB connected");
  } catch (err) {
    console.error("❌  Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }

  const ChartOfAccount = require("../models/ChartOfAccount");
  const Company        = require("../models/Company");

  if (dryRun) {
    console.log("\n🔍  DRY-RUN mode — no changes will be written to the database.\n");
  }

  console.log(`📚  Canonical chart contains ${Object.keys(CHART_OF_ACCOUNTS).length} account codes.\n`);

  // ── Resolve companies ──────────────────────────────────────────────
  let companies;
  if (companyId) {
    const company = await Company.findById(companyId).lean();
    if (!company) {
      console.error(`❌  Company not found: ${companyId}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    companies = [company];
    console.log(`🏢  Migrating 1 company: ${company.name || companyId}\n`);
  } else {
    companies = await Company.find({}).select("name").lean();
    console.log(`🏢  Migrating ${companies.length} companies…\n`);
  }

  // ── Run migration ──────────────────────────────────────────────────
  const totals = { inserted: 0, updated: 0, skipped: 0, errors: 0, companies: 0 };

  for (const company of companies) {
    const result = await migrateCompany(ChartOfAccount, company, dryRun);
    totals.inserted  += result.inserted;
    totals.updated   += result.updated;
    totals.skipped   += result.skipped;
    totals.errors    += result.errors;
    totals.companies += 1;
  }

  // ── Grand summary ──────────────────────────────────────────────────
  const dryNote = dryRun ? " (DRY RUN — nothing was written)" : "";
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Migration complete${dryNote}`);
  console.log(`  Companies processed : ${totals.companies}`);
  console.log(`  Accounts inserted   : ${totals.inserted}`);
  console.log(`  Accounts updated    : ${totals.updated}`);
  console.log(`  Already current     : ${totals.skipped}`);
  if (totals.errors > 0) {
    console.log(`  Errors              : ${totals.errors}  ⚠️`);
  }
  console.log("═══════════════════════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌  Unhandled error:", err);
  process.exit(1);
});
