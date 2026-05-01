/**
 * migratePurchaseReturnVatEntries.js
 *
 * Fixes purchase return journal entries that were posted to wrong VAT account (2100)
 * and moves them to the correct account (2210 - VAT Input).
 *
 * This corrects the GL imbalance where VAT Input was overstated.
 *
 * Usage:
 *   node scripts/migratePurchaseReturnVatEntries.js --dry-run
 *   node scripts/migratePurchaseReturnVatEntries.js
 *   node scripts/migratePurchaseReturnVatEntries.js --company=<companyId>
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const OLD_VAT_ACCOUNT = "2100";      // VAT Payable (legacy) - WRONG
const NEW_VAT_ACCOUNT = "2210";      // VAT Input - CORRECT
const OLD_INVENTORY_ACCOUNT = "5200"; // Purchase Returns - WRONG
const NEW_INVENTORY_ACCOUNT = "1400"; // Inventory - CORRECT

async function migrateCompany(companyId, dryRun) {
  const JournalEntry = require("../models/JournalEntry");
  const ChartOfAccount = require("../models/ChartOfAccount");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find all purchase_return journal entries with wrong accounts (2100 or 5200)
  const entries = await JournalEntry.find({
    company: companyId,
    sourceType: "purchase_return",
    status: { $in: ["posted", "draft"] },
    $or: [
      { "lines.accountCode": OLD_VAT_ACCOUNT },
      { "lines.accountCode": OLD_INVENTORY_ACCOUNT }
    ]
  }).lean();

  console.log(`   Found ${entries.length} purchase return entries with wrong accounts`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const vatLines = entry.lines.filter(
      (line) => line.accountCode === OLD_VAT_ACCOUNT && line.credit > 0
    );
    const invLines = entry.lines.filter(
      (line) => line.accountCode === OLD_INVENTORY_ACCOUNT && line.credit > 0
    );

    if (vatLines.length === 0 && invLines.length === 0) {
      skipped++;
      continue;
    }

    const totalVatCredit = vatLines.reduce((sum, line) => sum + line.credit, 0);
    const totalInvCredit = invLines.reduce((sum, line) => sum + line.credit, 0);

    console.log(`   🔍 Entry ${entry.entryNumber || entry._id}:`);
    if (totalVatCredit > 0) console.log(`      VAT credit: ${totalVatCredit}`);
    if (totalInvCredit > 0) console.log(`      Inventory credit: ${totalInvCredit}`);

    if (dryRun) {
      if (totalVatCredit > 0) console.log(`      [DRY-RUN] Would change VAT ${OLD_VAT_ACCOUNT} → ${NEW_VAT_ACCOUNT}`);
      if (totalInvCredit > 0) console.log(`      [DRY-RUN] Would change Inventory ${OLD_INVENTORY_ACCOUNT} → ${NEW_INVENTORY_ACCOUNT}`);
      fixed++;
      continue;
    }

    try {
      // Update the lines - fix both VAT and Inventory accounts
      const updatedLines = entry.lines.map((line) => {
        // Fix VAT account: 2100 → 2210
        if (line.accountCode === OLD_VAT_ACCOUNT && line.credit > 0) {
          return {
            ...line,
            accountCode: NEW_VAT_ACCOUNT,
            accountName: "VAT Input"
          };
        }
        // Fix Inventory account: 5200 → 1400
        if (line.accountCode === OLD_INVENTORY_ACCOUNT && line.credit > 0) {
          return {
            ...line,
            accountCode: NEW_INVENTORY_ACCOUNT,
            accountName: "Inventory"
          };
        }
        return line;
      });

      await JournalEntry.updateOne(
        { _id: entry._id },
        { $set: { lines: updatedLines, migratedAt: new Date() } }
      );

      if (totalVatCredit > 0) console.log(`      ✅ Fixed VAT: ${OLD_VAT_ACCOUNT} → ${NEW_VAT_ACCOUNT}`);
      if (totalInvCredit > 0) console.log(`      ✅ Fixed Inventory: ${OLD_INVENTORY_ACCOUNT} → ${NEW_INVENTORY_ACCOUNT}`);
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

  // Connect to database
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

  console.log(`\n🔄 Migrating Purchase Return Journal Entries`);
  console.log(`   VAT:      ${OLD_VAT_ACCOUNT} → ${NEW_VAT_ACCOUNT} (VAT Payable legacy → VAT Input)`);
  console.log(`   Inventory: ${OLD_INVENTORY_ACCOUNT} → ${NEW_INVENTORY_ACCOUNT} (Purchase Returns → Inventory)`);

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
