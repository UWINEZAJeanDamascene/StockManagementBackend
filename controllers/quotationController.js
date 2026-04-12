const Quotation = require('../models/Quotation');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Client = require('../models/Client');
const Company = require('../models/Company');
const PDFDocument = require('pdfkit');
const emailService = require('../services/emailService');
const {
  notifyQuotationCreated,
  notifyQuotationApproved,
  notifyQuotationExpired
} = require('../services/notificationHelper');

// Error codes
const ERR_QUOTATION_NOT_FOUND = 'QUOTATION_NOT_FOUND';
const ERR_QUOTATION_EXPIRED = 'QUOTATION_EXPIRED';
const ERR_QUOTATION_REJECTED = 'QUOTATION_REJECTED';
const ERR_QUOTATION_ALREADY_CONVERTED = 'QUOTATION_ALREADY_CONVERTED';
const ERR_INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION';
const ERR_INACTIVE_PRODUCT = 'INACTIVE_PRODUCT';

const sendQuotationEmail = async (quotation, company, action) => {
  try {
    const config = require('../src/config/environment').getConfig();
    if (!config.features?.emailNotifications || !config.email?.gmailUser) {
      return;
    }

    const client = await Client.findById(quotation.client);
    const clientEmail = client?.contact?.email || client?.email;
    if (!clientEmail) {
      console.warn('[Quotation] No client email found');
      return;
    }

    const qWithProducts = await Quotation.findById(quotation._id).populate('lines.product', 'name');

    const actionText = { sent: 'Sent', accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired' }[action] || 'Updated';
    const subject = `Quotation ${qWithProducts.quotationNumber || qWithProducts.referenceNo} - ${actionText}`;

    const lines = qWithProducts.lines || [];
    let itemsHtml = '';
    if (lines.length > 0) {
      itemsHtml = lines.map(line => `
        <tr>
          <td style="padding:10px; border-bottom:1px solid #ddd;">${line.product?.name || line.productName || 'Item'}</td>
          <td style="padding:10px; border-bottom:1px solid #ddd; text-align:center;">${line.quantity || 0}</td>
          <td style="padding:10px; border-bottom:1px solid #ddd; text-align:right;">${quotation.currencyCode || 'USD'} ${(line.unitPrice || 0).toFixed(2)}</td>
          <td style="padding:10px; border-bottom:1px solid #ddd; text-align:right;">${quotation.currencyCode || 'USD'} ${(line.lineTotal || 0).toFixed(2)}</td>
        </tr>
      `).join('');
    }

    const statusColor = action === 'accepted' ? '#10b981' : action === 'rejected' ? '#ef4444' : action === 'expired' ? '#f59e0b' : '#7c3aed';

    const html = `
      <div style="font-family:Arial,sans-serif; max-width:600px; margin:0 auto;">
        <div style="background:${statusColor}; padding:30px; border-radius:10px 10px 0 0;">
          <h1 style="color:white; margin:0; text-align:center;">📄 Quotation ${actionText}</h1>
        </div>
        <div style="background:#f9f9f9; padding:30px; border:1px solid #ddd; border-top:none; border-radius:0 0 10px 10px;">
          <h2 style="color:${statusColor}; margin:0 0 5px;">${qWithProducts.quotationNumber || qWithProducts.referenceNo || ''}</h2>
          <p style="color:#666; margin:5px 0;">Date: ${new Date(qWithProducts.quotationDate || qWithProducts.createdAt).toLocaleDateString()}</p>
          <p style="color:#666; margin:5px 0;">Status: <strong>${actionText}</strong></p>
          <div style="background:white; padding:15px; border-radius:8px; margin:20px 0;">
            <strong>Customer:</strong><br/>${client?.name || 'Customer'}
          </div>
          <table style="width:100%; border-collapse:collapse; margin:20px 0;">
            <thead>
              <tr style="background:${statusColor}; color:white;">
                <th style="padding:12px; text-align:left;">Product</th>
                <th style="padding:12px; text-align:center;">Qty</th>
                <th style="padding:12px; text-align:right;">Unit Price</th>
                <th style="padding:12px; text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div style="text-align:right; margin:20px 0;">
            <p style="margin:5px 0; font-size:18px; font-weight:bold; color:${statusColor};">Total: ${quotation.currencyCode || 'USD'} ${(qWithProducts.totalAmount || qWithProducts.grandTotal || 0).toFixed(2)}</p>
          </div>
          ${qWithProducts.validUntil ? `<p style="color:#666;">Valid until: ${new Date(qWithProducts.validUntil).toLocaleDateString()}</p>` : ''}
          <div style="text-align:center; margin-top:30px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/quotations/${quotation._id}" style="background:${statusColor}; color:white; padding:12px 30px; text-decoration:none; border-radius:8px; display:inline-block;">View Quotation</a>
          </div>
          <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;"/>
          <p style="font-size:12px; color:#888; text-align:center;">StockManager — Manage Your Stock From Supply to Final Sale</p>
        </div>
      </div>`;

    await emailService.sendEmail(clientEmail, subject, html);
  } catch (err) {
    console.error('[Quotation] Email failed:', err.message);
  }
};

// @desc    Validate products on quotation (check is_active)
// @access  Private
const validateQuotationProducts = async (lines, companyId) => {
  const inactiveProducts = [];
  
  for (const line of lines) {
    const product = await Product.findOne({ _id: line.product, company: companyId });
    if (!product) {
      inactiveProducts.push({ product: line.product, reason: 'Product not found' });
    } else if (!product.isActive) {
      inactiveProducts.push({ product: line.product, name: product.name, reason: 'Product is inactive' });
    }
  }
  
  return inactiveProducts;
};

// @desc    Check if quotation is expired
// @access  Private
const isQuotationExpired = (quotation) => {
  if (!quotation.expiryDate) return false;
  return new Date() > new Date(quotation.expiryDate);
};

// @desc    Get all quotations
// @route   GET /api/quotations
// @access  Private
exports.getQuotations = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { 
      page = 1, 
      limit = 20, 
      status, 
      clientId, 
      client_id,
      date_from, 
      date_to, 
      expiry_before 
    } = req.query;
    const query = { company: companyId };

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by client (support both clientId and client_id)
    const clientFilter = clientId || client_id;
    if (clientFilter) {
      query.client = clientFilter;
    }

    // Filter by quotation date range
    if (date_from || date_to) {
      query.quotationDate = {};
      if (date_from) query.quotationDate.$gte = new Date(date_from);
      if (date_to) query.quotationDate.$lte = new Date(date_to);
    }

    // Filter by expiry before date (for expired quotations)
    if (expiry_before) {
      query.expiryDate = { $lte: new Date(expiry_before) };
    }

    const total = await Quotation.countDocuments(query);
    const quotations = await Quotation.find(query)
      .populate('client', 'name code contact taxId')
      .populate('lines.product', 'name sku unit')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      success: true,
      count: quotations.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: quotations
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single quotation
// @route   GET /api/quotations/:id
// @access  Private
exports.getQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId })
      .populate('client', 'name code contact type taxId')
      .populate('lines.product', 'name sku unit')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('convertedToInvoice');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    res.json({
      success: true,
      data: quotation
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new quotation
// @route   POST /api/quotations
// @access  Private (admin, stock_manager, sales)
exports.createQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { lines } = req.body;

    // Validate products are active
    const inactiveProducts = await validateQuotationProducts(lines, companyId);
    if (inactiveProducts.length > 0) {
      return res.status(400).json({
        success: false,
        error: ERR_INACTIVE_PRODUCT,
        message: 'One or more products are inactive',
        inactiveProducts
      });
    }

    // Calculate line totals and prefer product tax defaults when available
    const processedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const product = await Product.findOne({ _id: line.product, company: companyId });
      
      // Get values as numbers
      const qty = parseFloat(line.qty || line.quantity || 0);
      const unitPrice = parseFloat(line.unitPrice || 0);
      const discountPct = parseFloat(line.discountPct || line.discount || 0);
      const taxRate = parseFloat(line.taxRate != null ? line.taxRate : (product?.taxRate != null ? product.taxRate : 0));
      
      // Calculate line totals
      const lineSubtotal = qty * unitPrice;
      const lineDiscount = lineSubtotal * (discountPct / 100);
      const lineTotalAfterDiscount = lineSubtotal - lineDiscount;
      const lineTax = lineTotalAfterDiscount * (taxRate / 100);
      const lineTotal = lineTotalAfterDiscount;
      
      processedLines.push({
        ...line,
        product: line.product,
        qty,
        unitPrice,
        discountPct,
        taxRate,
        lineTotal,
        lineTax
      });
    }

    const quotation = await Quotation.create({
      ...req.body,
      company: companyId,
      lines: processedLines,
      createdBy: req.user.id
    });

    await quotation.populate('client lines.product createdBy');

    res.status(201).json({
      success: true,
      data: quotation
    });
    // Notify quotation created
    try {
      await notifyQuotationCreated(companyId, quotation);
    } catch (e) {
      console.error('notifyQuotationCreated failed', e);
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Update quotation
// @route   PUT /api/quotations/:id
// @access  Private (admin, stock_manager, sales)
exports.updateQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    let quotation = await Quotation.findOne({ _id: req.params.id, company: companyId });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Only draft quotations can be fully edited
    // For sent quotations, we reset to draft first
    if (quotation.status === 'sent' && req.body.lines) {
      // Editing a sent quotation requires reset to draft
      req.body.status = 'draft';
    } else if (!['draft'].includes(quotation.status)) {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: `Cannot update quotation with status: ${quotation.status}. Only draft quotations can be edited.`
      });
    }

    // Validate products are active if lines are being updated
    if (req.body.lines) {
      const inactiveProducts = await validateQuotationProducts(req.body.lines, companyId);
      if (inactiveProducts.length > 0) {
        return res.status(400).json({
          success: false,
          error: ERR_INACTIVE_PRODUCT,
          message: 'One or more products are inactive',
          inactiveProducts
        });
      }
    }

    // Recalculate line totals if lines are updated
    if (req.body.lines) {
      const processedLines = [];
      for (let i = 0; i < req.body.lines.length; i++) {
        const line = req.body.lines[i];
        const qty = parseFloat(line.qty || line.quantity || 0);
        const unitPrice = parseFloat(line.unitPrice || 0);
        const discountPct = parseFloat(line.discountPct || line.discount || 0);
        const taxRate = parseFloat(line.taxRate || 0);
        
        const lineSubtotal = qty * unitPrice;
        const lineDiscount = lineSubtotal * (discountPct / 100);
        const lineTotalAfterDiscount = lineSubtotal - lineDiscount;
        const lineTax = lineTotalAfterDiscount * (taxRate / 100);
        const lineTotal = lineTotalAfterDiscount;
        
        processedLines.push({
          ...line,
          qty,
          unitPrice,
          discountPct,
          taxRate,
          lineTotal,
          lineTax
        });
      }
      req.body.lines = processedLines;
    }

    quotation = await Quotation.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      req.body,
      { new: true, runValidators: true }
    )
      .populate('client lines.product createdBy');

    res.json({
      success: true,
      data: quotation
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete quotation
// @route   DELETE /api/quotations/:id
// @access  Private (admin, sales)
exports.deleteQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Only draft quotations can be deleted
    if (quotation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft quotations can be deleted'
      });
    }

    await quotation.deleteOne();

    res.json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve quotation (deprecated - use acceptQuotation)
// @route   PUT /api/quotations/:id/approve
// @access  Private (admin, stock_manager)
exports.approveQuotation = async (req, res, next) => {
  // Redirect to acceptQuotation
  return exports.acceptQuotation(req, res, next);
};

// @desc    Send quotation
// @route   POST /api/quotations/:id/send
// @access  Private (admin, stock_manager, sales)
exports.sendQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: ERR_QUOTATION_NOT_FOUND,
        message: 'Quotation not found'
      });
    }

    // Only draft quotations can be sent
    if (quotation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: `Cannot send quotation with status: ${quotation.status}. Only draft quotations can be sent.`
      });
    }

    quotation.status = 'sent';
    await quotation.save();

    // Send email notification
    if (req.body.sendEmail) {
      const company = await Company.findById(companyId);
      await sendQuotationEmail(quotation, company, 'sent');
    }

    res.json({
      success: true,
      message: 'Quotation sent successfully',
      data: quotation
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Accept quotation
// @route   POST /api/quotations/:id/accept
// @access  Private (admin, stock_manager)
exports.acceptQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: ERR_QUOTATION_NOT_FOUND,
        message: 'Quotation not found'
      });
    }

    // Only sent quotations can be accepted
    if (quotation.status !== 'sent') {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: 'Only sent quotations can be accepted'
      });
    }

    // Check if quotation is expired
    if (isQuotationExpired(quotation)) {
      quotation.status = 'expired';
      await quotation.save();
      return res.status(409).json({
        success: false,
        error: ERR_QUOTATION_EXPIRED,
        message: 'Quotation has expired and cannot be accepted'
      });
    }

    quotation.status = 'accepted';
    quotation.approvedBy = req.user.id;
    quotation.approvedDate = new Date();

    await quotation.save();

    // Send email notification
    if (req.body.sendEmail) {
      const company = await Company.findById(companyId);
      await sendQuotationEmail(quotation, company, 'accepted');
    }

    res.json({
      success: true,
      message: 'Quotation accepted successfully',
      data: quotation
    });
    // Notify quotation accepted
    try {
      await notifyQuotationApproved(companyId, quotation, quotation.convertedToInvoice || null);
    } catch (e) {
      console.error('notifyQuotationApproved failed', e);
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Reject quotation
// @route   POST /api/quotations/:id/reject
// @access  Private (admin, stock_manager)
exports.rejectQuotation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: ERR_QUOTATION_NOT_FOUND,
        message: 'Quotation not found'
      });
    }

    // Only sent quotations can be rejected
    if (!['draft', 'sent'].includes(quotation.status)) {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: `Cannot reject quotation with status: ${quotation.status}. Only draft or sent quotations can be rejected.`
      });
    }

    quotation.status = 'rejected';
    await quotation.save();

    // Send email notification
    if (req.body.sendEmail) {
      const company = await Company.findById(companyId);
      await sendQuotationEmail(quotation, company, 'rejected');
    }

    res.json({
      success: true,
      message: 'Quotation rejected successfully',
      data: quotation
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Convert quotation to invoice
// @route   POST /api/quotations/:id/convert
// @access  Private (admin, stock_manager, sales)
exports.convertToInvoice = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId })
      .populate('lines.product');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: ERR_QUOTATION_NOT_FOUND,
        message: 'Quotation not found'
      });
    }

    // Check if quotation is expired
    if (isQuotationExpired(quotation)) {
      quotation.status = 'expired';
      await quotation.save();
      return res.status(409).json({
        success: false,
        error: ERR_QUOTATION_EXPIRED,
        message: 'Expired quotations cannot be converted to invoice'
      });
    }

    // Check if quotation is rejected
    if (quotation.status === 'rejected') {
      return res.status(409).json({
        success: false,
        error: ERR_QUOTATION_REJECTED,
        message: 'Rejected quotations cannot be converted to invoice'
      });
    }

    // Check if quotation is already converted
    if (quotation.status === 'converted' || quotation.convertedToInvoice) {
      return res.status(400).json({
        success: false,
        error: ERR_QUOTATION_ALREADY_CONVERTED,
        message: 'Quotation has already been converted to invoice'
      });
    }

    // Only accepted quotations can be converted
    if (quotation.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: 'Only accepted quotations can be converted to invoice'
      });
    }

    // Create invoice from quotation
    // Ensure lines include invoice's required fields
    const processedItems = (quotation.lines || []).map((line, idx) => {
      const quantity = parseFloat(line.qty || line.quantity || 0);
      const unitPrice = parseFloat(line.unitPrice || 0);
      const discount = parseFloat(line.discountPct || line.discount || 0);
      const subtotal = quantity * unitPrice;
      const netAmount = subtotal - (quantity * unitPrice * discount / 100);
      const taxRate = parseFloat(line.taxRate != null ? line.taxRate : (line.product?.taxRate != null ? line.product.taxRate : 0));
      const taxCode = line.taxCode || line.product?.taxCode || 'A';
      const taxAmount = netAmount * (taxRate / 100);
      const totalWithTax = netAmount + taxAmount;

      return {
        product: line.product,
        itemCode: line.itemCode || `ITEM-${idx + 1}`,
        description: line.description || (line.product && line.product.name) || '',
        quantity,
        unit: line.unit || (line.product && line.product.unit) || '',
        unitPrice,
        discount,
        taxCode,
        taxRate,
        taxAmount,
        subtotal,
        totalWithTax
      };
    });

    const invoicePayload = {
      company: companyId,
      client: quotation.client,
      quotation: quotation._id,
      items: processedItems,
      terms: quotation.terms,
      notes: quotation.notes,
      createdBy: req.user.id,
      dueDate: req.body.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days default
    };

    const invoice = await Invoice.create(invoicePayload);

    // Update client outstanding balance
    const client = await Client.findById(quotation.client);
    if (client) {
      client.outstandingBalance += parseFloat(invoice.roundedAmount) || 0;
      await client.save();
    }

    // Update quotation
    quotation.status = 'converted';
    quotation.convertedToInvoice = invoice._id;
    quotation.conversionDate = new Date();
    await quotation.save();

     await invoice.populate('client lines.product createdBy');
    res.status(201).json({
      success: true,
      message: 'Quotation converted to invoice successfully',
      data: invoice
    });
    // Notify quotation approved/converted
    try {
      await notifyQuotationApproved(companyId, quotation, invoice.invoiceNumber);
    } catch (e) {
      console.error('notifyQuotationApproved (convert) failed', e);
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Convert quotation to sales order (NEW WORKFLOW)
// @route   POST /api/quotations/:id/convert-to-so
// @access  Private (admin, stock_manager, sales)
exports.convertToSalesOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { expectedDate, notes, terms } = req.body;
    
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId })
      .populate('lines.product');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: ERR_QUOTATION_NOT_FOUND,
        message: 'Quotation not found'
      });
    }

    // Check if quotation is expired
    if (isQuotationExpired(quotation)) {
      quotation.status = 'expired';
      await quotation.save();
      return res.status(409).json({
        success: false,
        error: ERR_QUOTATION_EXPIRED,
        message: 'Expired quotations cannot be converted'
      });
    }

    // Check if quotation is rejected
    if (quotation.status === 'rejected') {
      return res.status(409).json({
        success: false,
        error: ERR_QUOTATION_REJECTED,
        message: 'Rejected quotations cannot be converted'
      });
    }

    // Check if quotation is already converted
    if (quotation.status === 'converted' || quotation.convertedToSalesOrder || quotation.convertedToInvoice) {
      return res.status(400).json({
        success: false,
        error: ERR_QUOTATION_ALREADY_CONVERTED,
        message: 'Quotation has already been converted'
      });
    }

    // Only accepted quotations can be converted
    if (quotation.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        error: ERR_INVALID_STATUS_TRANSITION,
        message: 'Only accepted quotations can be converted to sales order'
      });
    }

    const SalesOrder = require('../models/SalesOrder');
    
    // Create sales order lines from quotation lines
    const salesOrderLines = (quotation.lines || []).map(line => ({
      product: line.product?._id || line.product,
      description: line.description || (line.product && line.product.name) || '',
      qty: parseFloat(line.qty || line.quantity || 0),
      unitPrice: parseFloat(line.unitPrice || 0),
      discountPct: parseFloat(line.discountPct || line.discount || 0),
      taxRate: parseFloat(line.taxRate != null ? line.taxRate : (line.product?.taxRate != null ? line.product.taxRate : 0)),
      taxCode: line.taxCode || line.product?.taxCode || 'A',
      unit: line.unit || (line.product && line.product.unit) || ''
    }));

    // Create sales order
    const salesOrder = await SalesOrder.create({
      company: companyId,
      client: quotation.client,
      quotation: quotation._id,
      lines: salesOrderLines,
      orderDate: new Date(),
      expectedDate: expectedDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days default
      terms: terms || quotation.terms,
      notes: notes || quotation.notes,
      currencyCode: quotation.currencyCode || 'USD',
      createdBy: req.user.id,
      status: 'draft' // Start as draft, needs to be confirmed to reserve stock
    });

    // Update quotation
    quotation.status = 'converted';
    quotation.convertedToSalesOrder = salesOrder._id;
    quotation.conversionDate = new Date();
    await quotation.save();

    await salesOrder.populate('client lines.product createdBy');

    res.status(201).json({
      success: true,
      message: 'Quotation converted to sales order successfully',
      data: salesOrder
    });

    // Notify
    try {
      await notifyQuotationApproved(companyId, quotation, salesOrder.referenceNo);
    } catch (e) {
      console.error('notifyQuotationApproved (convert to SO) failed', e);
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get quotations for a specific client
// @route   GET /api/quotations/client/:clientId
// @access  Private
exports.getClientQuotations = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotations = await Quotation.find({ client: req.params.clientId, company: companyId })
      .populate('lines.product', 'name sku')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quotations.length,
      data: quotations
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get quotations containing a specific product
// @route   GET /api/quotations/product/:productId
// @access  Private
exports.getProductQuotations = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotations = await Quotation.find({ 'lines.product': req.params.productId, company: companyId })
      .populate('client', 'name code')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quotations.length,
      data: quotations
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Generate quotation PDF
// @route   GET /api/quotations/:id/pdf
// @access  Private
exports.generateQuotationPDF = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const quotation = await Quotation.findOne({ _id: req.params.id, company: companyId })
      .populate('client')
      .populate('lines.product')
      .populate('createdBy');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=quotation-${quotation.referenceNo}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // Layout helpers
    const left = 48;
    const right = 48;
    const availWidth = doc.page.width - left - right;
    const bottomLimit = doc.page.height - 80;
    // Column percents for: No, Description, Unit, Qty, Unit rate FRW, Total With VAT FRW
    // Tuned to avoid wrapping and keep totals column wide enough
    const colPercents = [0.06, 0.48, 0.08, 0.08, 0.16, 0.14];
    const colWidths = colPercents.map(p => Math.floor(availWidth * p));
    // adjust rounding to fill available width
    const sumCols = colWidths.reduce((s, v) => s + v, 0);
    if (sumCols < availWidth) colWidths[colWidths.length - 1] += (availWidth - sumCols);

    let pageNum = 1;
    const drawFooter = (p) => {
      const bottom = doc.page.height - 40;
      doc.fontSize(8).fillColor('#9ca3af').font('Helvetica');
      doc.text(`Generated: ${new Date().toLocaleString()}`, left, bottom, { align: 'left' });
      doc.text(`Page ${p}`, 0, bottom, { align: 'right' });
    };

    const renderHeader = () => {
      // Title
      doc.fontSize(20).fillColor('#111827').text('QUOTATION', { align: 'center' });
      doc.moveDown(0.6);

      // Prepare left and right columns and render line-by-line so they stay parallel
      const startY = doc.y;
      const lineHeight = 14;
      const leftLines = [
        `Quotation Number: ${quotation.referenceNo}`,
        `Date: ${new Date(quotation.quotationDate || quotation.createdAt).toLocaleDateString()}`,
        `Valid Until: ${quotation.expiryDate ? new Date(quotation.expiryDate).toLocaleDateString() : 'N/A'}`,
        `Status: ${quotation.status?.toUpperCase() || 'N/A'}`
      ];

      const clientX = left + Math.floor(availWidth * 0.55);
      const rightLines = [];
      rightLines.push('Quotation To:');
      rightLines.push(quotation.client?.name || 'N/A');
      rightLines.push(quotation.client?.taxId ? `TIN: ${quotation.client.taxId}` : '');
      rightLines.push(quotation.client?.contact?.address || '');
      rightLines.push(quotation.client?.contact?.phone ? `Phone: ${quotation.client.contact.phone}` : '');
      rightLines.push(quotation.client?.contact?.email ? `Email: ${quotation.client.contact.email}` : '');

      const maxLines = Math.max(leftLines.length, rightLines.length);
      doc.fontSize(10).fillColor('#111827').font('Helvetica');
      for (let i = 0; i < maxLines; i++) {
        const yLine = startY + (i * lineHeight);
        // left column
        if (leftLines[i]) {
          doc.text(leftLines[i], left, yLine);
        }
        // right column (first line underlined label)
        if (rightLines[i]) {
          if (i === 0) {
            doc.text(rightLines[i], clientX, yLine, { underline: true });
          } else {
            doc.text(rightLines[i], clientX, yLine);
          }
        }
      }

      // Move doc.y below the taller column
      doc.y = startY + (maxLines * lineHeight) + 8;
    };

    const renderTableHeader = (y) => {
      doc.rect(left - 8, y, availWidth + 16, 28).fill('#111827');
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
      let x = left;
      const headers = ['No.', 'Description', 'Unit', 'Qty', 'Unit rate FRW', 'Total With VAT FRW'];
      headers.forEach((h, i) => {
        const align = (i >= 2) ? 'right' : 'left';
        doc.text(h, x, y + 8, { width: colWidths[i], align });
        x += colWidths[i];
      });
      doc.fillColor('#111827').font('Helvetica');
    };

    // Print header and table header
    renderHeader();
    let y = doc.y;
    renderTableHeader(y);
    y += 34;

    // Lines
    doc.fontSize(9).font('Helvetica');
    for (let idx = 0; idx < quotation.lines.length; idx++) {
      const line = quotation.lines[idx];
      const desc = line.product?.name || line.description || '';
      const unit = line.unit || (line.product?.unit || '');
      const qty = String(line.qty || line.quantity || '');
      const unitPrice = `RWF ${Number(line.unitPrice || 0).toFixed(2)}`;
      const total = `RWF ${Number(line.lineTotal || line.total || 0).toFixed(2)}`;

      // Measure heights for all cells (so rows expand for any wrapped column)
      const hNo = doc.heightOfString(String(idx + 1), { width: colWidths[0] });
      const hDesc = doc.heightOfString(String(desc), { width: colWidths[1] });
      const hUnit = doc.heightOfString(String(unit), { width: colWidths[2] });
      const hQty = doc.heightOfString(String(qty), { width: colWidths[3] });
      const hUnitPrice = doc.heightOfString(String(unitPrice), { width: colWidths[4] });
      const hTotal = doc.heightOfString(String(total), { width: colWidths[5] });
      const rowHeight = Math.max(hNo, hDesc, hUnit, hQty, hUnitPrice, hTotal, 12);

      // Page break if needed
      if (y + rowHeight > bottomLimit) {
        drawFooter(pageNum);
        doc.addPage();
        pageNum += 1;
        renderHeader();
        y = doc.y;
        renderTableHeader(y);
        y += 34;
      }

      // Alternating shading
      if (idx % 2 === 0) {
        doc.rect(left - 8, y - 6, availWidth + 16, rowHeight + 8).fill('#fbfbfc');
        doc.fillColor('#111827');
      }

      // Render cells
      let x = left;
      doc.text(String(idx + 1), x, y, { width: colWidths[0] }); x += colWidths[0];
      doc.text(String(desc), x, y, { width: colWidths[1] }); x += colWidths[1];
      doc.text(String(unit), x, y, { width: colWidths[2], align: 'right' }); x += colWidths[2];
      doc.text(qty, x, y, { width: colWidths[3], align: 'right' }); x += colWidths[3];
      doc.text(unitPrice, x, y, { width: colWidths[4], align: 'right' }); x += colWidths[4];
      doc.text(total, x, y, { width: colWidths[5], align: 'right' });

      y += rowHeight + 8;
    }

    // Totals block (right aligned)
    if (y + 100 > bottomLimit) {
      drawFooter(pageNum);
      doc.addPage();
      pageNum += 1;
      renderHeader();
      y = doc.y;
      renderTableHeader(y);
      y += 34;
    }

    // Totals box placed below table, right-aligned, with fixed height to prevent overlap
    const totalsBoxWidth = Math.floor(availWidth * 0.36);
    const totalsX = left + availWidth - totalsBoxWidth;
    const totalsY = y;
    const totalsBoxHeight = 88;
    // Page break if totals box would overflow
    if (totalsY + totalsBoxHeight > bottomLimit) {
      drawFooter(pageNum);
      doc.addPage();
      pageNum += 1;
      renderHeader();
      y = doc.y;
      renderTableHeader(y);
      y += 34;
    }

    // Draw totals box with left labels and right values
    doc.rect(totalsX - 6, totalsY - 6, totalsBoxWidth + 12, totalsBoxHeight).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    const innerPad = 8;
    let ty = totalsY + innerPad;
    doc.fontSize(10).text(`Total VAT Exclusive (RWF):`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'left' });
    doc.text(`${Number(quotation.subtotal || 0).toFixed(2)}`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'right' });
    ty += 20;
    doc.text(`VAT (18%):`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'left' });
    doc.text(`${Number(quotation.taxAmount || 0).toFixed(2)}`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'right' });
    ty += 22;
    doc.font('Helvetica-Bold').fontSize(12).text(`Value Total Amount (RWF):`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'left' });
    doc.text(`${Number(quotation.totalAmount || 0).toFixed(2)}`, totalsX + innerPad, ty, { width: totalsBoxWidth - innerPad * 2, align: 'right' });
    doc.font('Helvetica').fontSize(10);
    // Advance y past totals box
    y = totalsY + totalsBoxHeight + 12;

    y += 28;
    // Terms & Notes
    if (quotation.terms || quotation.notes) {
      if (y + 120 > bottomLimit) {
        drawFooter(pageNum);
        doc.addPage();
        pageNum += 1;
        renderHeader();
        y = doc.y;
      }
      doc.moveDown(1);
      if (quotation.terms) {
        doc.font('Helvetica-Bold').fontSize(10).text('Terms & Conditions:', left);
        doc.font('Helvetica').fontSize(9).text(quotation.terms, { width: availWidth });
        doc.moveDown(0.5);
      }
      if (quotation.notes) {
        doc.font('Helvetica-Bold').fontSize(10).text('Notes:', left);
        doc.font('Helvetica').fontSize(9).text(quotation.notes, { width: availWidth });
      }
    }

    drawFooter(pageNum);
    doc.end();
  } catch (error) {
    next(error);
  }
};
