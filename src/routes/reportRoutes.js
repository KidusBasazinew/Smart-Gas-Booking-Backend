const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");

const reportController = require("../controllers/reportController");

const router = express.Router();

router.use(auth);

// Reports (admin only)
router.get("/daily", requireRole("admin"), reportController.getDailyReport);
router.get("/monthly", requireRole("admin"), reportController.getMonthlyReport);
router.get(
  "/stations/:stationId",
  requireRole("admin"),
  validateObjectIdParam("stationId"),
  reportController.getStationReport,
);
router.get(
  "/drivers/:driverId",
  requireRole("admin"),
  validateObjectIdParam("driverId"),
  reportController.getDriverReport,
);
router.get("/export", requireRole("admin"), reportController.exportReport);

// Notifications (any authenticated user)
router.get("/notifications/me", reportController.getMyNotifications);
router.patch(
  "/notifications/:id/read",
  validateObjectIdParam("id"),
  reportController.markNotificationRead,
);
router.post(
  "/notifications/broadcast",
  requireRole("admin"),
  [
    body("role")
      .optional()
      .trim()
      .isIn(["driver", "attendant", "admin"])
      .withMessage("role invalid"),
    body("title").notEmpty().withMessage("title is required").trim(),
    body("message").notEmpty().withMessage("message is required").trim(),
    body("type")
      .optional()
      .trim()
      .isIn(["info", "warning", "success", "error"])
      .withMessage("type invalid"),
  ],
  validateRequest,
  reportController.adminBroadcastNotification,
);

// Fraud scan (admin only)
router.get("/fraud/scan", requireRole("admin"), reportController.scanFraud);

module.exports = router;

