const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const qrController = require("../controllers/qrController");

const router = express.Router();

router.post(
  "/generate/:bookingId",
  auth,
  requireRole("driver"),
  validateObjectIdParam("bookingId"),
  qrController.generateQR,
);

router.get(
  "/me/:bookingId",
  auth,
  requireRole("driver"),
  validateObjectIdParam("bookingId"),
  qrController.getMyActiveQR,
);

router.post(
  "/validate",
  auth,
  requireRole("attendant", "admin"),
  [
    body("token")
      .trim()
      .notEmpty()
      .withMessage("token is required")
      .isLength({ min: 16, max: 256 })
      .withMessage("token invalid"),
  ],
  validateRequest,
  qrController.validateQR,
);

router.patch(
  "/invalidate/:bookingId",
  auth,
  requireRole("driver", "admin"),
  validateObjectIdParam("bookingId"),
  qrController.invalidateQR,
);

router.post(
  "/admin/cleanup",
  auth,
  requireRole("admin"),
  qrController.cleanupExpiredQR,
);

module.exports = router;
