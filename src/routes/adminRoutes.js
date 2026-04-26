const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const auditAdmin = require("../middlewares/auditAdmin");

const adminController = require("../controllers/adminController");

const router = express.Router();

router.use(auth);
router.use(requireRole("admin"));

router.get("/dashboard", adminController.getDashboardSummary);
router.get("/activity", adminController.getRecentActivity);

router.get("/users", adminController.getUsers);
router.patch(
  "/users/:id/status",
  validateObjectIdParam("id"),
  [
    body("isApproved")
      .optional()
      .isBoolean()
      .withMessage("isApproved must be boolean"),
    body("isBlocked")
      .optional()
      .isBoolean()
      .withMessage("isBlocked must be boolean"),
    body("role")
      .optional()
      .trim()
      .isIn(["driver", "attendant", "admin"])
      .withMessage("role invalid"),
  ],
  validateRequest,
  auditAdmin("update_user_status"),
  adminController.updateUserStatus,
);

router.get("/drivers/pending", adminController.getPendingDrivers);
router.patch(
  "/drivers/:id/approve",
  validateObjectIdParam("id"),
  auditAdmin("approve_driver"),
  adminController.approveDriver,
);
router.patch(
  "/drivers/:id/reject",
  validateObjectIdParam("id"),
  auditAdmin("reject_driver"),
  adminController.rejectDriver,
);

router.get("/stations", adminController.getStationsAdmin);
router.patch(
  "/stations/:id",
  validateObjectIdParam("id"),
  auditAdmin("update_station"),
  adminController.updateStationAdmin,
);

router.get("/bookings", adminController.getBookingsAdmin);
router.patch(
  "/bookings/:id/cancel",
  validateObjectIdParam("id"),
  auditAdmin("cancel_booking"),
  adminController.cancelBookingAdmin,
);

router.get("/transactions", adminController.getTransactionsAdmin);

router.get("/fraud-alerts", adminController.getFraudAlerts);
router.get("/analytics", adminController.getAnalytics);

router.patch(
  "/quotas/:driverId",
  validateObjectIdParam("driverId"),
  [
    body("monthlyLimit")
      .notEmpty()
      .withMessage("monthlyLimit is required")
      .isFloat({ min: 0 })
      .withMessage("monthlyLimit must be a number >= 0"),
  ],
  validateRequest,
  auditAdmin("set_quota"),
  adminController.setQuotaAdmin,
);

router.get("/system-health", adminController.getSystemHealth);

module.exports = router;
