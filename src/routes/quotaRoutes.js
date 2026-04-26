const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const quotaController = require("../controllers/quotaController");

const router = express.Router();

router.post(
  "/init",
  auth,
  requireRole("driver"),
  quotaController.initializeMyQuota,
);
router.get("/me", auth, requireRole("driver"), quotaController.getMyQuota);

router.get(
  "/admin/all",
  auth,
  requireRole("admin"),
  quotaController.adminGetAllQuotas,
);

router.patch(
  "/admin/set/:driverId",
  auth,
  requireRole("admin"),
  validateObjectIdParam("driverId"),
  [
    body("monthlyLimit")
      .notEmpty()
      .withMessage("monthlyLimit is required")
      .isFloat({ min: 0 })
      .withMessage("monthlyLimit must be >= 0"),
    body("notes")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("notes too long"),
  ],
  validateRequest,
  quotaController.adminSetQuota,
);

router.patch(
  "/admin/adjust/:driverId",
  auth,
  requireRole("admin"),
  validateObjectIdParam("driverId"),
  [
    body("deltaLiters")
      .optional()
      .isFloat()
      .withMessage("deltaLiters must be a number"),
    body("usedLiters")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("usedLiters must be >= 0"),
    body("notes")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("notes too long"),
  ],
  validateRequest,
  quotaController.adminAdjustUsedLiters,
);

router.post(
  "/admin/reset-all",
  auth,
  requireRole("admin"),
  quotaController.resetMonthlyQuotaForAll,
);

module.exports = router;
