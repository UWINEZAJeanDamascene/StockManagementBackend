const express = require("express");
const router = express.Router();
const {
  getFloats,
  getFloat,
  createFloat,
  updateFloat,
  deleteFloat,
  getExpenses,
  getExpense,
  createExpense,
  updateExpense,
  approveExpense,
  deleteExpense,
  getReplenishments,
  getReplenishment,
  createReplenishment,
  approveReplenishment,
  completeReplenishment,
  rejectReplenishment,
  cancelReplenishment,
  getReport,
  getSummary,
  getTransactions,
  // New endpoints per Module 4 spec
  getFunds,
  createFund,
  topUp,
  recordExpense,
  getFundTransactions,
} = require("../controllers/pettyCashController");

const { protect } = require("../middleware/auth");

// All routes require authentication
router.use(protect);

// =====================================================
// NEW API ENDPOINTS PER MODULE 4 SPEC
// =====================================================

// Fund routes (new endpoints per spec)
router.route("/funds").get(getFunds).post(createFund);

router.route("/funds/:id").get(getFloat);

router.route("/funds/:id/top-up").post(topUp);

router.route("/funds/:id/expense").post(recordExpense);

router.route("/funds/:id/transactions").get(getFundTransactions);

// =====================================================
// LEGACY/EXISTING ROUTES
// =====================================================

// Float routes
router.route("/floats").get(getFloats).post(createFloat);

router.route("/floats/:id").get(getFloat).put(updateFloat).delete(deleteFloat);

// Expense routes
router.route("/expenses").get(getExpenses).post(createExpense);

router
  .route("/expenses/:id")
  .get(getExpense)
  .put(updateExpense)
  .delete(deleteExpense);

router.route("/expenses/:id/approve").put(approveExpense);

// Replenishment routes
router
  .route("/replenishments")
  .get(getReplenishments)
  .post(createReplenishment);

// Single replenishment detail
router.route("/replenishments/:id").get(getReplenishment);

router.route("/replenishments/:id/approve").put(approveReplenishment);

router.route("/replenishments/:id/complete").put(completeReplenishment);

router.route("/replenishments/:id/reject").put(rejectReplenishment);

router.route("/replenishments/:id/cancel").put(cancelReplenishment);

// Report & Summary routes
router.route("/report").get(getReport);

router.route("/summary").get(getSummary);

// Transactions history
router.route("/transactions").get(getTransactions);

module.exports = router;
