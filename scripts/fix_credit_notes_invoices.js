/**
 * Script to fix credit notes that weren't properly applied to invoices
 * Run with: node scripts/fix_credit_notes_invoices.js
 * 
 * FIX: Credit notes should NOT reduce amountPaid - they should only reduce balance
 * The invoice stays "paid" and credit note is tracked separately
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Invoice = require('../models/Invoice');
const CreditNote = require('../models/CreditNote');

async function fixCreditNotes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB Connected');
    
    console.log('Finding all issued/approved credit notes...');
    
    // Find all credit notes that are issued or applied (not drafts)
    const creditNotes = await CreditNote.find({ 
      status: { $in: ['issued', 'applied'] }
    }).populate('invoice');
    
    console.log(`Found ${creditNotes.length} credit notes to check.`);
    
    let fixedCount = 0;
    
    for (const note of creditNotes) {
      console.log(`\n ${note.creditNoteNumber}`);
      console.log(`  Status: ${note.status}`);
      console.log(`  Amount: ${note.grandTotal}`);
      console.log(`  Linked Invoice: ${note.invoice ? note.invoice.invoiceNumber : 'NONE'}`);
      
      if (!note.invoice) {
        console.log('  SKIP: No invoice linked');
        continue;
      }
      
      const invoice = await Invoice.findById(note.invoice._id);
      if (!invoice) {
        console.log('  SKIP: Invoice not found');
        continue;
      }
      
      console.log(`  Invoice Current grandTotal: ${invoice.grandTotal}`);
      console.log(`  Invoice Current amountPaid: ${invoice.amountPaid}`);
      console.log(`  Invoice Current balance: ${invoice.balance}`);
      console.log(`  Invoice Current status: ${invoice.status}`);
      
      // Check if credit note is already in the array
      const alreadyApplied = invoice.creditNotes && invoice.creditNotes.some(
        cn => cn.creditNoteId && cn.creditNoteId.toString() === note._id.toString()
      );
      
      // Calculate what the original amountPaid should be (before credit note)
      // The credit note should NOT reduce amountPaid - only balance
      // Original amountPaid = amountPaid + credit note amount (if balance went negative)
      let originalAmountPaid = invoice.amountPaid;
      
      // The balance should be: grandTotal - amountPaid (but with credit note reducing it)
      // After credit note: balance = grandTotal - amountPaid - creditNoteAmount
      // So: amountPaid = grandTotal - balance - creditNoteAmount
      // Or: balance = grandTotal - amountPaid - creditNoteAmount
      
      const totalCreditNotes = invoice.creditNotes 
        ? invoice.creditNotes.reduce((sum, cn) => sum + (cn.amount || 0), 0) 
        : 0;
      const expectedBalance = Math.max(0, invoice.grandTotal - invoice.amountPaid - totalCreditNotes);
      
      // If balance is wrong, fix it - but DON'T touch amountPaid
      if (Math.abs(invoice.balance - expectedBalance) > 0.01) {
        console.log(`  FIXING: Updating balance from ${invoice.balance} to ${expectedBalance}`);
        invoice.balance = expectedBalance;
      }
      
      // Keep status as 'paid' if amountPaid >= grandTotal (accounting for credit notes)
      // A credit note doesn't change the payment status - it's a separate adjustment
      const effectiveTotal = invoice.grandTotal - totalCreditNotes;
      if (invoice.amountPaid >= effectiveTotal) {
        invoice.status = 'paid';
        if (!invoice.paidDate) invoice.paidDate = new Date();
      }
      
      if (!alreadyApplied) {
        // Add credit note to the array
        console.log('  Adding credit note to invoice...');
        if (!invoice.creditNotes) invoice.creditNotes = [];
        invoice.creditNotes.push({
          creditNoteId: note._id,
          creditNoteNumber: note.creditNoteNumber,
          amount: note.grandTotal,
          appliedDate: note.issueDate || new Date()
        });
        
        // Recalculate balance: grandTotal - amountPaid - creditNoteAmount
        const newTotalCredits = totalCreditNotes + note.grandTotal;
        invoice.balance = Math.max(0, invoice.grandTotal - invoice.amountPaid - newTotalCredits);
        
        // Keep status as paid - credit note is a refund, not partial payment
        if (invoice.amountPaid >= invoice.grandTotal) {
          invoice.status = 'paid';
        }
      }
      
      await invoice.save();
      fixedCount++;
      console.log('  DONE: Invoice updated');
      console.log(`  New balance: ${invoice.balance}`);
      console.log(`  New status: ${invoice.status}`);
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Total credit notes processed: ${creditNotes.length}`);
    console.log(`Invoices fixed: ${fixedCount}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected');
  }
}

fixCreditNotes();
