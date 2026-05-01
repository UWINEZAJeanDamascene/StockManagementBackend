/**
 * fixInvoiceFromQuotation.js
 *
 * Fixes invoices created from quotations where line items have wrong field names.
 * - Copies 'quantity' → 'qty' if qty is 0/missing
 * - Recalculates lineTax and lineTotal from unitPrice, qty, taxRate
 * - Updates invoice totals
 *
 * Usage:
 *   node scripts/fixInvoiceFromQuotation.js --dry-run
 *   node scripts/fixInvoiceFromQuotation.js
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

async function fixInvoices(companyId, dryRun) {
  const Invoice = require("../models/Invoice");
  const Quotation = require("../models/Quotation");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find all invoices linked to quotations (created from quotation conversion)
  const invoices = await Invoice.find({
    company: companyId,
    quotation: { $exists: true, $ne: null }
  }).populate('quotation');

  console.log(`   Found ${invoices.length} invoices created from quotations`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const invoice of invoices) {
    const hasZeroQty = invoice.lines?.some(line => !line.qty || line.qty === 0);
    const hasCorruptedTax = invoice.lines?.some(line => 
      line.taxAmount && (typeof line.taxAmount === 'object' || 
                        (typeof line.taxAmount === 'string' && line.taxAmount.includes('[object')))
    );
    const hasMissingTotals = invoice.lines?.some(line => !line.lineTotal || !line.lineTax);
    
    if (!hasZeroQty && !hasCorruptedTax && !hasMissingTotals) {
      skipped++;
      continue;
    }

    console.log(`   🔍 Invoice ${invoice.referenceNo || invoice._id}:`);
    console.log(`      Issues: ${hasZeroQty ? 'qty=0 ' : ''}${hasCorruptedTax ? 'corrupted-tax ' : ''}${hasMissingTotals ? 'missing-totals ' : ''}`);

    if (dryRun) {
      console.log(`      [DRY-RUN] Would fix line items`);
      fixed++;
      continue;
    }

    try {
      // Get source quotation data
      const quotation = invoice.quotation;
      const sourceLines = quotation?.lines || [];

      // Rebuild lines with correct data
      const updatedLines = invoice.lines.map((line, idx) => {
        const sourceLine = sourceLines[idx];
        
        // Get qty from source or existing line
        let qty = line.qty;
        if (!qty || qty === 0) {
          qty = parseFloat(sourceLine?.qty || sourceLine?.quantity || line.quantity || 0);
        }

        const unitPrice = parseFloat(line.unitPrice || sourceLine?.unitPrice || 0);
        const taxRate = parseFloat(line.taxRate || sourceLine?.taxRate || 0);
        const discountPct = parseFloat(line.discountPct || sourceLine?.discountPct || 0);

        // Recalculate
        const lineSubtotal = qty * unitPrice;
        const discountAmount = lineSubtotal * (discountPct / 100);
        const netAmount = lineSubtotal - discountAmount;
        const lineTax = netAmount * (taxRate / 100);
        const lineTotal = netAmount + lineTax;

        console.log(`      Line ${idx + 1}: qty=${qty}, unitPrice=${unitPrice}, tax=${lineTax.toFixed(2)}, total=${lineTotal.toFixed(2)}`);

        return {
          ...line.toObject(),
          qty,
          unitPrice,
          taxRate,
          discountPct,
          lineSubtotal,
          lineTax,
          lineTotal,
          taxAmount: lineTax,  // backwards compat alias
          totalWithTax: lineTotal  // backwards compat
        };
      });

      // Recalculate invoice totals
      let subtotal = 0;
      let totalTax = 0;
      updatedLines.forEach(line => {
        subtotal += line.lineSubtotal || 0;
        totalTax += line.lineTax || 0;
      });
      const grandTotal = subtotal + totalTax;

      await Invoice.updateOne(
        { _id: invoice._id },
        { 
          $set: {
            lines: updatedLines,
            subtotal,
            taxAmount: totalTax,
            totalTax,
            totalAmount: grandTotal,
            grandTotal,
            migratedAt: new Date()
          }
        }
      );

      console.log(`      ✅ Fixed: subtotal=${subtotal.toFixed(2)}, tax=${totalTax.toFixed(2)}, total=${grandTotal.toFixed(2)}`);
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

  console.log(`\n🔄 Fixing Invoices Created from Quotations`);

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
  console.log(`  Invoices checked:    ${totals.total}`);
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
