/**
 * fixInvoiceLineItems.js
 *
 * Fixes invoice line items that have incorrect field names from quotation conversion.
 * - Converts 'quantity' to 'qty'
 * - Ensures lineTax and lineTotal are numbers not objects
 * - Recalculates invoice totals
 *
 * Usage:
 *   node scripts/fixInvoiceLineItems.js --dry-run
 *   node scripts/fixInvoiceLineItems.js
 *   node scripts/fixInvoiceLineItems.js --company=<companyId>
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

async function fixInvoices(companyId, dryRun) {
  const Invoice = require("../models/Invoice");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find all invoices with problematic line items
  const invoices = await Invoice.find({
    company: companyId,
    $or: [
      { "lines.quantity": { $exists: true } },  // Old field name
      { "lines.taxAmount": { $type: "object" } },  // Corrupted tax
      { "lines.lineTax": { $type: "object" } },  // Corrupted tax
      { "totalTax": { $type: "object" } },  // Corrupted total tax
    ]
  }).lean();

  console.log(`   Found ${invoices.length} invoices with issues`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const invoice of invoices) {
    console.log(`   🔍 Invoice ${invoice.referenceNo || invoice._id}:`);

    let needsFix = false;
    const updatedLines = (invoice.lines || []).map(line => {
      const updates = { ...line };

      // Fix 1: Convert quantity to qty
      if (line.quantity !== undefined && line.qty === undefined) {
        updates.qty = parseFloat(line.quantity);
        delete updates.quantity;
        needsFix = true;
        console.log(`      Line ${line._id}: quantity → qty (${updates.qty})`);
      }

      // Fix 2: Ensure lineTax is a number
      if (line.lineTax !== undefined && typeof line.lineTax === 'object') {
        const taxVal = line.lineTax?.$numberDecimal || line.lineTax?.toString() || 0;
        updates.lineTax = parseFloat(taxVal);
        needsFix = true;
        console.log(`      Line ${line._id}: lineTax was object, now ${updates.lineTax}`);
      }

      // Fix 3: Ensure taxAmount is a number (alias for lineTax)
      if (line.taxAmount !== undefined && typeof line.taxAmount === 'object') {
        const taxVal = line.taxAmount?.$numberDecimal || line.taxAmount?.toString() || 0;
        updates.taxAmount = parseFloat(taxVal);
        needsFix = true;
        console.log(`      Line ${line._id}: taxAmount was object, now ${updates.taxAmount}`);
      }

      // Fix 4: Ensure lineTotal is a number
      if (line.lineTotal !== undefined && typeof line.lineTotal === 'object') {
        const totalVal = line.lineTotal?.$numberDecimal || line.lineTotal?.toString() || 0;
        updates.lineTotal = parseFloat(totalVal);
        needsFix = true;
        console.log(`      Line ${line._id}: lineTotal was object, now ${updates.lineTotal}`);
      }

      return updates;
    });

    // Fix invoice-level tax fields
    let totalTaxFix = invoice.totalTax;
    if (invoice.totalTax !== undefined && typeof invoice.totalTax === 'object') {
      totalTaxFix = parseFloat(invoice.totalTax?.$numberDecimal || invoice.totalTax?.toString() || 0);
      needsFix = true;
      console.log(`      totalTax was object, now ${totalTaxFix}`);
    }

    let taxAmountFix = invoice.taxAmount;
    if (invoice.taxAmount !== undefined && typeof invoice.taxAmount === 'object') {
      taxAmountFix = parseFloat(invoice.taxAmount?.$numberDecimal || invoice.taxAmount?.toString() || 0);
      needsFix = true;
      console.log(`      taxAmount was object, now ${taxAmountFix}`);
    }

    if (!needsFix) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`      [DRY-RUN] Would fix this invoice`);
      fixed++;
      continue;
    }

    try {
      const updateData = {
        lines: updatedLines,
        migratedAt: new Date()
      };

      if (totalTaxFix !== undefined) updateData.totalTax = totalTaxFix;
      if (taxAmountFix !== undefined) updateData.taxAmount = taxAmountFix;

      await Invoice.updateOne(
        { _id: invoice._id },
        { $set: updateData }
      );

      console.log(`      ✅ Fixed invoice`);
      fixed++;
    } catch (err) {
      console.error(`      ❌ Error: ${err.message}`);
      errors++;
    }
  }

  return { fixed, skipped, errors, total: invoices.length };
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

  console.log(`\n🔄 Fixing Invoice Line Items`);
  console.log(`   Fixing: quantity → qty, corrupted tax objects → numbers`);

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
    const result = await fixInvoices(company._id, dryRun);
    totals.fixed += result.fixed;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
    totals.total += result.total;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log(`  Companies processed: ${companies.length}`);
  console.log(`  Invoices found:      ${totals.total}`);
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
