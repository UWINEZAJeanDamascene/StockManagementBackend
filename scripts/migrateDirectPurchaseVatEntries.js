/**
 * migrateDirectPurchaseVatEntries.js
 *
 * Fixes direct purchase journal entries that were posted to wrong VAT account (1500)
 * and moves them to the correct account (2210 - VAT Input).
 *
 * Usage:
 *   node scripts/migrateDirectPurchaseVatEntries.js --dry-run
 *   node scripts/migrateDirectPurchaseVatEntries.js
 *   node scripts/migrateDirectPurchaseVatEntries.js --company=<companyId>
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const OLD_VAT_ACCOUNT = "1500";  // VAT Receivable (legacy) - WRONG
const NEW_VAT_ACCOUNT = "2210";  // VAT Input - CORRECT

async function migrateCompany(companyId, dryRun) {
  const JournalEntry = require("../models/JournalEntry");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find all journal entries with VAT lines using 1500
  // This includes: purchase, expense, asset_purchase, purchase_return
  const entries = await JournalEntry.find({
    company: companyId,
    status: { $in: ["posted", "draft"] },
    "lines.accountCode": OLD_VAT_ACCOUNT,
    $or: [
      { sourceType: "purchase" },
      { sourceType: "expense" },
      { sourceType: "asset_purchase" },
      { sourceType: "purchase_return" }
    ]
  }).lean();

  console.log(`   Found ${entries.length} entries with wrong VAT account (1500)`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const vatLines = entry.lines.filter(
      (line) => line.accountCode === OLD_VAT_ACCOUNT
    );

    if (vatLines.length === 0) {
      skipped++;
      continue;
    }

    const totalVat = vatLines.reduce((sum, line) => sum + (line.debit || 0) + (line.credit || 0), 0);

    console.log(`   🔍 Entry ${entry.entryNumber || entry._id} (${entry.sourceType}): VAT ${totalVat}`);

    if (dryRun) {
      console.log(`      [DRY-RUN] Would change ${OLD_VAT_ACCOUNT} → ${NEW_VAT_ACCOUNT}`);
      fixed++;
      continue;
    }

    try {
      // Update the VAT line account code from 1500 to 2210
      const updatedLines = entry.lines.map((line) => {
        if (line.accountCode === OLD_VAT_ACCOUNT) {
          return {
            ...line,
            accountCode: NEW_VAT_ACCOUNT,
            accountName: "VAT Input"
          };
        }
        return line;
      });

      await JournalEntry.updateOne(
        { _id: entry._id },
        { $set: { lines: updatedLines, migratedAt: new Date() } }
      );

      console.log(`      ✅ Fixed: ${OLD_VAT_ACCOUNT} → ${NEW_VAT_ACCOUNT}`);
      fixed++;
    } catch (err) {
      console.error(`      ❌ Error: ${err.message}`);
      errors++;
    }
  }

  return { fixed, skipped, errors, total: entries.length };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const companyArg = args.find((a) => a.startsWith("--company="));
  const companyId = companyArg ? companyArg.split("=")[1] : null;

  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/stock_tenancy";
  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ Failed to connect:", err.message);
    process.exit(1);
  }

  const Company = require("../models/Company");

  if (dryRun) {
    console.log("\n🔍 DRY-RUN mode — no changes will be written\n");
  }

  console.log(`\n🔄 Migrating Direct Purchase VAT entries`);
  console.log(`   From: ${OLD_VAT_ACCOUNT} (VAT Receivable legacy)`);
  console.log(`   To:   ${NEW_VAT_ACCOUNT} (VAT Input)`);

  let companies;
  if (companyId) {
    const company = await Company.findById(companyId).lean();
    if (!company) {
      console.error(`❌ Company not found: ${companyId}`);
      process.exit(1);
    }
    companies = [company];
  } else {
    companies = await Company.find({}).select("_id name").lean();
  }

  console.log(`\n📊 Processing ${companies.length} company(s)\n`);

  const totals = { fixed: 0, skipped: 0, errors: 0, total: 0 };

  for (const company of companies) {
    const result = await migrateCompany(company._id, dryRun);
    totals.fixed += result.fixed;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
    totals.total += result.total;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log(`  Companies processed: ${companies.length}`);
  console.log(`  Entries found:       ${totals.total}`);
  console.log(`  Fixed:               ${totals.fixed}`);
  console.log(`  Skipped:             ${totals.skipped}`);
  if (totals.errors > 0) {
    console.log(`  Errors:              ${totals.errors} ⚠️`);
  }
  if (dryRun) {
    console.log("\n  [DRY-RUN — no changes made]");
  }
  console.log("═══════════════════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Unhandled error:", err);
  process.exit(1);
});
