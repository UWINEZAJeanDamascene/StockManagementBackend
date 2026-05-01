/**
 * debugInvoice.js - Debug script to inspect invoice data
 */

"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

async function debugInvoice() {
  const Invoice = require("../models/Invoice");
  
  // Find invoices from quotations
  const invoices = await Invoice.find({
    quotation: { $exists: true, $ne: null }
  }).populate('quotation').lean();

  for (const invoice of invoices) {
    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`Invoice: ${invoice.referenceNo || invoice._id}`);
    console.log(`═══════════════════════════════════════════════════`);
    
    console.log(`\nInvoice totals:`);
    console.log(`  subtotal: ${invoice.subtotal} (type: ${typeof invoice.subtotal})`);
    console.log(`  taxAmount: ${invoice.taxAmount} (type: ${typeof invoice.taxAmount})`);
    console.log(`  totalTax: ${invoice.totalTax} (type: ${typeof invoice.totalTax})`);
    console.log(`  totalAmount: ${invoice.totalAmount} (type: ${typeof invoice.totalAmount})`);
    console.log(`  grandTotal: ${invoice.grandTotal} (type: ${typeof invoice.grandTotal})`);
    
    console.log(`\nLine items (${invoice.lines?.length || 0}):`);
    (invoice.lines || []).forEach((line, i) => {
      console.log(`  Line ${i + 1}:`);
      console.log(`    qty: ${line.qty} (type: ${typeof line.qty})`);
      console.log(`    quantity: ${line.quantity} (type: ${typeof line.quantity})`);
      console.log(`    unitPrice: ${line.unitPrice}`);
      console.log(`    taxRate: ${line.taxRate}`);
      console.log(`    taxAmount: ${line.taxAmount} (type: ${typeof line.taxAmount})`);
      console.log(`    lineTax: ${line.lineTax} (type: ${typeof line.lineTax})`);
      console.log(`    lineTotal: ${line.lineTotal} (type: ${typeof line.lineTotal})`);
      console.log(`    subtotal: ${line.subtotal} (type: ${typeof line.subtotal})`);
      console.log(`    totalWithTax: ${line.totalWithTax} (type: ${typeof line.totalWithTax})`);
    });
    
    if (invoice.quotation) {
      console.log(`\nSource Quotation: ${invoice.quotation.referenceNo || invoice.quotation._id}`);
      console.log(`Quotation lines (${invoice.quotation.lines?.length || 0}):`);
      (invoice.quotation.lines || []).forEach((line, i) => {
        console.log(`  Line ${i + 1}:`);
        console.log(`    qty: ${line.qty}`);
        console.log(`    unitPrice: ${line.unitPrice}`);
        console.log(`    taxRate: ${line.taxRate}`);
        console.log(`    lineTotal: ${line.lineTotal}`);
      });
    }
  }
  
  await mongoose.disconnect();
}

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/stock_tenancy";
mongoose.connect(uri).then(() => {
  console.log("✅ MongoDB connected");
  debugInvoice();
}).catch(err => {
  console.error("❌ Failed to connect:", err);
  process.exit(1);
});
