/**
 * forceFixInvoices.js
 *
 * Force-fixes ALL invoices created from quotations by recalculating from source.
 * This rebuilds line items with correct field names and values.
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

async function fixInvoices(companyId, dryRun) {
  const Invoice = require("../models/Invoice");
  const Quotation = require("../models/Quotation");

  console.log(`\n🏢 Processing company: ${companyId}`);

  // Find ALL invoices linked to quotations
  const invoices = await Invoice.find({
    company: companyId,
    quotation: { $exists: true, $ne: null }
  }).populate('quotation');

  console.log(`   Found ${invoices.length} invoices created from quotations`);

  let fixed = 0;
  let errors = 0;

  for (const invoice of invoices) {
    console.log(`\n   🔧 Invoice ${invoice.referenceNo || invoice._id}:`);

    if (dryRun) {
      console.log(`      [DRY-RUN] Would recalculate from quotation`);
      fixed++;
      continue;
    }

    try {
      // Get source quotation data
      const quotation = invoice.quotation;
      const sourceLines = quotation?.lines || [];

      if (!sourceLines.length) {
        console.log(`      ⚠️ No source lines found in quotation`);
        continue;
      }

      // Rebuild ALL lines with correct data
      const updatedLines = sourceLines.map((sourceLine, idx) => {
        const qty = parseFloat(sourceLine.qty || sourceLine.quantity || 0);
        const unitPrice = parseFloat(sourceLine.unitPrice || 0);
        const taxRate = parseFloat(sourceLine.taxRate != null ? sourceLine.taxRate : 0);
        const discountPct = parseFloat(sourceLine.discountPct || sourceLine.discount || 0);
        const unit = sourceLine.unit || sourceLine.product?.unit || '';

        // Recalculate
        const lineSubtotal = qty * unitPrice;
        const discountAmount = lineSubtotal * (discountPct / 100);
        const netAmount = lineSubtotal - discountAmount;
        const lineTax = netAmount * (taxRate / 100);
        const lineTotal = netAmount + lineTax;

        console.log(`      Line ${idx + 1}: qty=${qty}, unitPrice=${unitPrice}, tax=${lineTax.toFixed(2)}, total=${lineTotal.toFixed(2)}`);

        return {
          product: sourceLine.product?._id || sourceLine.product,
          productCode: sourceLine.itemCode || `ITEM-${idx + 1}`,
          description: sourceLine.description || sourceLine.product?.name || '',
          qty,
          unit,
          unitPrice,
          discountPct,
          taxCode: sourceLine.taxCode || 'A',
          taxRate,
          lineSubtotal,
          lineTax,
          lineTotal
        };
      });

      // Recalculate invoice totals
      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;
      
      updatedLines.forEach(line => {
        subtotal += line.lineSubtotal || 0;
        totalTax += line.lineTax || 0;
        totalDiscount += (line.lineSubtotal * line.discountPct / 100) || 0;
      });
      
      const grandTotal = subtotal - totalDiscount + totalTax;

      await Invoice.updateOne(
        { _id: invoice._id },
        { 
          $set: {
            lines: updatedLines,
            subtotal: mongoose.Types.Decimal128.fromString(subtotal.toFixed(2)),
            taxAmount: mongoose.Types.Decimal128.fromString(totalTax.toFixed(2)),
            totalTax,
            totalDiscount,
            totalAmount: mongoose.Types.Decimal128.fromString(grandTotal.toFixed(2)),
            grandTotal,
            roundedAmount: Math.round(grandTotal * 100) / 100,
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

  return { fixed, errors, total: invoices.length };
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
    console.log("\n⚠️  LIVE mode — WILL modify invoices\n");
  }

  console.log(`🔄 Force-Fixing All Invoices from Quotations`);

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
    const result = await fixInvoices(company._id, dryRun);
    totals.fixed += result.fixed;
    totals.errors += result.errors;
    totals.total += result.total;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log(`  Companies processed: ${companies.length}`);
  console.log(`  Invoices found:      ${totals.total}`);
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
