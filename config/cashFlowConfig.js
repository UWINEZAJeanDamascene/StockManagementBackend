/**
 * Cash Flow Classification Configuration
 * 
 * Maps source_type from journal entries to cash flow statement sections.
 * This configuration drives the Cash Flow Statement report classification.
 * 
 * Each source_type maps to:
 * - operating_inflows / operating_outflows
 * - investing_inflows / investing_outflows
 * - financing_inflows / financing_outflows
 */

module.exports = {
  /**
   * Classification mapping by source_type
   * Used by CashFlowService to categorize cash movements
   */
  CASH_FLOW_CLASSIFICATION: {
    // ── OPERATING ────────────────────────────────────────────────────
    // Cash received from core business operations
    operating_inflows: [
      'ar_receipt'           // customer payments received
    ],
    
    // Cash paid for core business operations
    operating_outflows: [
      'ap_payment',          // supplier payments made
      'expense',             // operating expenses paid
      'petty_cash_expense',  // petty cash expenses
      'tax_settlement',      // VAT paid to authorities
      'payroll_run'          // net salaries paid
    ],

    // ── INVESTING ────────────────────────────────────────────────────
    // Cash from disposal of long-term assets
    investing_inflows: [
      'asset_disposal'       // proceeds from asset sales
    ],
    
    // Cash used to acquire long-term assets
    investing_outflows: [
      'asset_purchase'       // fixed asset purchases
    ],

    // ── FINANCING ────────────────────────────────────────────────────
    // Cash from financing activities (debt/equity)
    financing_inflows: [
      'liability_drawdown',  // loans received
      'opening_balance'      // initial equity/opening entries to bank
    ],
    
    // Cash used for financing activities
    financing_outflows: [
      'liability_repayment'  // loan repayments
    ]
  },

  /**
   * Section display names for reports
   */
  SECTION_NAMES: {
    operating: 'Operating Activities',
    investing: 'Investing Activities',
    financing: 'Financing Activities'
  },

  /**
   * Cash flow calculation method
   * 'direct' - sums actual cash inflows/outflows
   * 'indirect' - starts from net profit and adjusts
   */
  CALCULATION_METHOD: 'direct',

  /**
   * Include reconciliation verification
   */
  VERIFY_RECONCILIATION: true,

  /**
   * Tolerance for reconciliation difference (in currency units)
   */
  RECONCILIATION_TOLERANCE: 0.01
};
