/**
 * fixDeliveryNoteQty.js
 *
 * Fixes delivery note lines that have 0 orderedQty due to Decimal128 conversion bug.
 * Recalculates from the linked invoice.
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && value.$numberDecimal) {
    return parseFloat(value.$numberDecimal);
  }
  if (typeof value === 'string') return parseFloat(value) || 0;
  return 0;
};

async function fixDeliveryNotes(companyId, dryRun) {
  const DeliveryNote = require("../models/DeliveryNote");
  const Invoice = require("../models/Invoice");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find delivery notes with 0 orderedQty
  const deliveryNotes = await DeliveryNote.find({
    company: companyId,
    $or: [
      { "lines.orderedQty": 0 },
      { "lines.orderedQty": null },
      { "lines.orderedQty": { $exists: false } }
    ]
  }).populate('invoice');

  console.log(`   Found ${deliveryNotes.length} delivery notes with qty issues`);

  let fixed = 0;
  let errors = 0;

  for (const dn of deliveryNotes) {
    console.log(`\n   🔧 DN ${dn.referenceNo || dn._id}:`);

    if (!dn.invoice) {
      console.log(`      ⚠️ No linked invoice, skipping`);
      continue;
    }

    const invoice = dn.invoice;
    let updated = false;

    for (const line of dn.lines) {
      const invoiceLine = invoice.lines.id(line.invoiceLineId);
      if (!invoiceLine) {
        console.log(`      ⚠️ Invoice line ${line.invoiceLineId} not found`);
        continue;
      }

      const invoiceQty = toNumber(invoiceLine.quantity);
      if (invoiceQty > 0 && line.orderedQty === 0) {
        console.log(`      Line ${line.productCode}: orderedQty 0 → ${invoiceQty}`);
        line.orderedQty = invoiceQty;
        if (!line.qtyToDeliver) line.qtyToDeliver = invoiceQty;
        if (!line.pendingQty) line.pendingQty = invoiceQty;
        updated = true;
      }
    }

    if (!updated) {
      console.log(`      ℹ️ No changes needed`);
      continue;
    }

    if (dryRun) {
      console.log(`      [DRY-RUN] Would save changes`);
      fixed++;
      continue;
    }

    try {
      await dn.save();
      console.log(`      ✅ Fixed and saved`);
      fixed++;
    } catch (err) {
      console.error(`      ❌ Error: ${err.message}`);
      errors++;
    }
  }

  return { fixed, errors, total: deliveryNotes.length };
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
  } else {
    console.log("\n⚠️  LIVE mode — WILL modify delivery notes\n");
  }

  console.log(`🔄 Fixing Delivery Note Quantities`);

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

  const totals = { fixed: 0, errors: 0, total: 0 };

  for (const company of companies) {
    const result = await fixDeliveryNotes(company._id, dryRun);
    totals.fixed += result.fixed;
    totals.errors += result.errors;
    totals.total += result.total;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log(`  Companies processed: ${companies.length}`);
  console.log(`  DNs found:           ${totals.total}`);
  console.log(`  Fixed:               ${totals.fixed}`);
  if (totals.errors > 0) {
    console.log(`  Errors:              ${totals.errors} ⚠️`);
  }
  if (dryRun) {
    console.log("\n  [DRY-RUN — no changes made]");
    console.log("  Run without --dry-run to apply fixes");
  }
  console.log("═══════════════════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Unhandled error:", err);
  process.exit(1);
});
