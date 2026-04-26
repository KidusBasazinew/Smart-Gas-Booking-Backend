const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const transactionController = require("../controllers/transactionController");

const router = express.Router();

router.post(
  "/dispense",
  auth,
  requireRole("attendant", "admin"),
  [
    body("token")
      .trim()
      .notEmpty()
      .withMessage("token is required")
      .isLength({ min: 16, max: 256 })
      .withMessage("token invalid"),
    body("liters")
      .notEmpty()
      .withMessage("liters is required")
      .isFloat({ gt: 0 })
      .withMessage("liters must be a number > 0"),
    body("paymentMethod")
      .trim()
      .notEmpty()
      .withMessage("paymentMethod is required"),
    body("pricePerLiter")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("pricePerLiter must be a number >= 0"),
    body("pumpNumber").optional().trim(),
  ],
  validateRequest,
  transactionController.dispenseFuel,
);

router.get(
  "/me",
  auth,
  requireRole("driver"),
  transactionController.getMyTransactions,
);

router.get(
  "/station",
  auth,
  requireRole("attendant", "admin"),
  transactionController.getStationTransactions,
);

router.get(
  "/receipt/:id",
  auth,
  requireRole("driver", "attendant", "admin"),
  validateObjectIdParam("id"),
  transactionController.getReceipt,
);

router.get(
  "/:id",
  auth,
  requireRole("driver", "attendant", "admin"),
  validateObjectIdParam("id"),
  transactionController.getTransactionById,
);

router.patch(
  "/reverse/:id",
  auth,
  requireRole("admin"),
  validateObjectIdParam("id"),
  transactionController.reverseTransaction,
);

module.exports = router;
