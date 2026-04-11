const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Product = require('../models/Product');
const CashDrawer = require('../models/CashDrawer');
const StockMovement = require('../models/StockMovement');
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { BankAccount } = require('../models/BankAccount');
const JournalService = require('../services/journalService');

// Create a sale (POS) - supports split payments
exports.createSale = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { items = [], payments = [], clientId, clientInfo, drawerId, notes } = req.body;

    // Load company settings to get default tax rate when POS doesn't provide one
    const company = await Company.findById(companyId).lean();
    const defaultTaxRate = company?.settings?.taxRate ?? 0;
    const defaultTaxCode = (defaultTaxRate > 0 ? 'B' : 'A');

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in sale' });
    }

    // Resolve or create walk-in client
    let client = null;
    if (clientId) {
      client = await Client.findOne({ _id: clientId, company: companyId });
    }

    if (!client) {
      // Find or create a generic Walk-in client per company
      client = await Client.findOne({ company: companyId, code: 'WALKIN' });
      if (!client) {
        client = await Client.create({
          company: companyId,
          name: (clientInfo && clientInfo.name) || 'Walk-in Customer',
          code: 'WALKIN',
          type: 'individual',
          contact: clientInfo?.contact || {}
        });
      }
    }

    // Build invoice items - ensure product references and calculate simple subtotals
    const invoiceItems = [];
    for (const it of items) {
      const product = await Product.findOne({ _id: it.product, company: companyId });
      if (!product) return res.status(400).json({ success: false, message: 'Invalid product in items' });

      const quantity = it.quantity || 1;
      const unitPrice = it.unitPrice != null ? it.unitPrice : 0;
      const discount = it.discount || 0;
      // Normalize tax code and rate - prefer product defaults
      let itemTaxCode = it.taxCode || product.taxCode || defaultTaxCode; // prefer item -> product -> company
      // Derive rate from product or company settings if not provided
      let derivedRateFromCode = product?.taxRate != null ? product.taxRate : (itemTaxCode === 'B' ? (company?.settings?.taxRate ?? 18) : 0);
      let itemTaxRate = (it.taxRate != null ? it.taxRate : (product?.taxRate != null ? product.taxRate : derivedRateFromCode));
      // Ensure consistency: if rate > 0, code must be 'B'; if rate = 0, code 'A' or 'None'
      if (itemTaxRate > 0 && itemTaxCode !== 'B') itemTaxCode = 'B';
      if ((itemTaxRate === 0 || itemTaxRate == null) && itemTaxCode !== 'A' && itemTaxCode !== 'None') itemTaxCode = 'A';

      const itemSubtotal = quantity * unitPrice;
      const netAmount = itemSubtotal - discount;
      const taxAmount = netAmount * (itemTaxRate / 100);

      invoiceItems.push({
        product: product._id,
        itemCode: product.sku,
        description: product.name,
        quantity: quantity,
        unit: it.unit || product.unit,
        unitPrice: unitPrice,
        discount: discount,
        taxCode: itemTaxCode,
        taxRate: itemTaxRate,
        taxAmount: taxAmount,
        subtotal: itemSubtotal,
        totalWithTax: netAmount + taxAmount
      });
    }

    const invoice = new Invoice({
      company: companyId,
      client: client._id,
      customerName: client.name,
      customerTin: client.taxId || undefined,
      customerAddress: client.contact?.address || undefined,
      items: invoiceItems,
      createdBy: req.user.id,
      notes: notes || ''
    });

    // Attach payments if provided
    if (payments && payments.length) {
      payments.forEach(p => invoice.payments.push({
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        reference: p.reference,
        notes: p.notes,
        bankAccountId: p.bankAccountId,
        recordedBy: req.user.id
      }));

      invoice.amountPaid = invoice.payments.reduce((s, p) => s + (p.amount || 0), 0);
    }

    // Saving will compute totals via pre-save hook
    await invoice.save();

    // Deduct stock for each sold item AND create stock movement records
    for (const it of invoiceItems) {
      try {
        const prod = await Product.findById(it.product);
        if (prod) {
          const qtySold = it.quantity || 0;
          const previousStock = prod.currentStock || 0;
          prod.currentStock = Math.max(0, previousStock - qtySold);
          prod.lastSaleDate = new Date();
          await prod.save();
          
          // Create stock movement record
          await StockMovement.create({
            company: companyId,
            product: prod._id,
            type: 'sale',
            quantity: -qtySold,
            reference: invoice.invoiceNumber,
            notes: `POS Sale - ${invoice.invoiceNumber}`,
            createdBy: req.user.id
          });
        }
      } catch (err) {
        // non-fatal
        console.warn('Failed to update product stock', err.message);
      }
    }

    // Record cash transactions in drawer when payment method is cash
    if (drawerId) {
      try {
        let drawer = await CashDrawer.findOne({ company: companyId, drawerId });
        if (drawer && drawer.status === 'open') {
          invoice.payments.forEach(p => {
            if (p.paymentMethod === 'cash') {
              drawer.transactions.push({
                type: 'sale',
                amount: p.amount,
                paymentMethod: p.paymentMethod,
                reference: p.reference,
                notes: `Sale ${invoice._id}`,
                recordedBy: req.user.id
              });
            }
          });
          await drawer.save();
        }
      } catch (err) {
        console.warn('Failed to record drawer transactions', err.message);
      }
    }

    // Create bank transactions for bank-based payments
    const bankPaymentMethods = ['bank_transfer', 'cheque', 'mobile_money'];
    for (const p of invoice.payments) {
      if (bankPaymentMethods.includes(p.paymentMethod) && p.bankAccountId) {
        try {
          const bankAccount = await BankAccount.findOne({
            _id: p.bankAccountId,
            company: companyId,
            isActive: true
          });
          if (bankAccount) {
            await bankAccount.addTransaction({
              type: 'deposit',
              amount: p.amount,
              description: `POS Sale - Invoice ${invoice.invoiceNumber}`,
              date: new Date(),
              referenceNumber: p.reference || invoice.invoiceNumber,
              paymentMethod: p.paymentMethod,
              status: 'completed',
              reference: invoice._id,
              referenceType: 'Invoice',
              createdBy: req.user.id,
              notes: p.notes || `POS payment for invoice ${invoice.invoiceNumber}`
            });
          }
        } catch (bankErr) {
          console.warn('Failed to create bank transaction for POS sale', bankErr.message);
        }
      }
    }

    // Create journal entry for POS sale
    try {
      const DEFAULT_ACCOUNTS = require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS;
      const lines = [];
      
      // Debit: Cash/Bank (based on payment method)
      for (const p of invoice.payments) {
        let cashAccount = DEFAULT_ACCOUNTS.cashInHand;
        if (p.bankAccountId) {
          const bankAccount = await BankAccount.findById(p.bankAccountId);
          if (bankAccount && bankAccount.ledgerAccountId) {
            cashAccount = bankAccount.ledgerAccountId;
          }
        } else if (p.paymentMethod === 'mobile_money') {
          cashAccount = DEFAULT_ACCOUNTS.mtnMoMo;
        }
        
        lines.push(JournalService.createDebitLine(
          cashAccount,
          p.amount,
          `POS Sale - ${invoice.invoiceNumber}`
        ));
      }
      
      // Credit: Sales Revenue
      lines.push(JournalService.createCreditLine(
        DEFAULT_ACCOUNTS.salesRevenue,
        invoice.roundedAmount || invoice.totalAmount,
        `POS Sale - ${invoice.invoiceNumber}`
      ));
      
      await JournalService.createEntry(companyId, req.user.id, {
        date: new Date(),
        description: `POS Sale - Invoice ${invoice.invoiceNumber}`,
        sourceType: 'invoice',
        sourceReference: invoice.invoiceNumber,
        lines,
        isAutoGenerated: true
      });
    } catch (jeErr) {
      console.warn('Failed to create journal entry for POS sale', jeErr.message);
    }

    // Sync client totals and outstanding balance for POS sale
    try {
      const clientDoc = await Client.findOne({ _id: client._id, company: companyId });
      if (clientDoc) {
        const paid = invoice.amountPaid || 0;
        const rounded = invoice.roundedAmount || 0;
        const outstandingDelta = Math.max(0, rounded - paid);
        clientDoc.outstandingBalance = Math.max(0, (clientDoc.outstandingBalance || 0) + outstandingDelta);
        clientDoc.totalPurchases = (clientDoc.totalPurchases || 0) + paid;
        clientDoc.lastPurchaseDate = new Date();
        await clientDoc.save();
      }
    } catch (e) {
      console.warn('Failed to update client totals for POS sale', e.message);
    }

    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// Add a payment to an existing sale (split payments)
exports.addPayment = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const invoice = await Invoice.findOne({ _id: req.params.id, company: companyId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Sale not found' });

    const { amount, paymentMethod, reference, notes, drawerId, bankAccountId } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid payment amount' });

    const payment = { amount, paymentMethod, reference, notes, bankAccountId, recordedBy: req.user.id };
    invoice.payments.push(payment);
    invoice.amountPaid = (invoice.amountPaid || 0) + amount;
    invoice.balance = Math.max(0, invoice.roundedAmount - invoice.amountPaid);

    if (invoice.amountPaid >= invoice.roundedAmount) {
      invoice.status = 'paid';
      invoice.paidDate = new Date();
    } else if (invoice.amountPaid > 0) {
      invoice.status = 'partial';
    }

    await invoice.save();

    // Drawer record
    if (drawerId && paymentMethod === 'cash') {
      try {
        let drawer = await CashDrawer.findOne({ company: companyId, drawerId });
        if (drawer && drawer.status === 'open') {
          drawer.transactions.push({ type: 'sale', amount, paymentMethod, reference, notes, recordedBy: req.user.id });
          await drawer.save();
        }
      } catch (err) {
        console.warn('Drawer record failed', err.message);
      }
    }

    // Create bank transaction for bank-based payments
    const bankPaymentMethods = ['bank_transfer', 'cheque', 'mobile_money'];
    if (bankPaymentMethods.includes(paymentMethod) && bankAccountId) {
      try {
        const bankAccount = await BankAccount.findOne({
          _id: bankAccountId,
          company: companyId,
          isActive: true
        });
        if (bankAccount) {
          await bankAccount.addTransaction({
            type: 'deposit',
            amount: amount,
            description: `POS Payment - Invoice ${invoice.invoiceNumber}`,
            date: new Date(),
            referenceNumber: reference || invoice.invoiceNumber,
            paymentMethod: paymentMethod,
            status: 'completed',
            reference: invoice._id,
            referenceType: 'Invoice',
            createdBy: req.user.id,
            notes: notes || `POS payment for invoice ${invoice.invoiceNumber}`
          });
        }
      } catch (bankErr) {
        console.warn('Failed to create bank transaction for POS payment', bankErr.message);
      }
    }

    // Update client totals to reflect POS payment
    try {
      const clientDoc = await Client.findOne({ _id: invoice.client, company: companyId });
      if (clientDoc) {
        clientDoc.totalPurchases = (clientDoc.totalPurchases || 0) + amount;
        clientDoc.outstandingBalance = Math.max(0, (clientDoc.outstandingBalance || 0) - amount);
        clientDoc.lastPurchaseDate = new Date();
        await clientDoc.save();
      }
    } catch (e) {
      console.warn('Failed updating client after POS payment', e.message);
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// Open cash drawer
exports.openDrawer = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { drawerId, openingBalance = 0, notes } = req.body;
    if (!drawerId) return res.status(400).json({ success: false, message: 'drawerId required' });

    let drawer = await CashDrawer.findOne({ company: companyId, drawerId });
    if (!drawer) {
      drawer = await CashDrawer.create({ company: companyId, drawerId, openingBalance, status: 'open', openedBy: req.user.id, openedAt: new Date(), notes });
    } else {
      drawer.status = 'open';
      drawer.openingBalance = openingBalance;
      drawer.openedBy = req.user.id;
      drawer.openedAt = new Date();
      drawer.notes = notes || drawer.notes;
      drawer.transactions = drawer.transactions || [];
      await drawer.save();
    }

    res.json({ success: true, data: drawer });
  } catch (error) {
    next(error);
  }
};

// Close cash drawer
exports.closeDrawer = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { drawerId, closingBalance = 0, notes } = req.body;
    if (!drawerId) return res.status(400).json({ success: false, message: 'drawerId required' });

    const drawer = await CashDrawer.findOne({ company: companyId, drawerId });
    if (!drawer) return res.status(404).json({ success: false, message: 'Drawer not found' });

    drawer.status = 'closed';
    drawer.closingBalance = closingBalance;
    drawer.closedBy = req.user.id;
    drawer.closedAt = new Date();
    drawer.notes = notes || drawer.notes;
    await drawer.save();

    res.json({ success: true, data: drawer });
  } catch (error) {
    next(error);
  }
};

// Get drawer status and transactions
exports.getDrawer = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const drawerId = req.params.drawerId;
    if (!drawerId) return res.status(400).json({ success: false, message: 'drawerId required' });

    const drawer = await CashDrawer.findOne({ company: companyId, drawerId }).populate('transactions.recordedBy', 'name email');
    if (!drawer) return res.status(404).json({ success: false, message: 'Drawer not found' });

    res.json({ success: true, data: drawer });
  } catch (error) {
    next(error);
  }
};

// Return printable receipt data for a sale
exports.getReceipt = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const invoice = await Invoice.findOne({ _id: req.params.id, company: companyId })
      .populate('client', 'name contact code')
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku');

    if (!invoice) return res.status(404).json({ success: false, message: 'Sale not found' });

    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};
