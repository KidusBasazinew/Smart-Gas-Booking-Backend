const express = require("express");
const { body, query } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const bookingController = require("../controllers/bookingController");

const router = express.Router();

router.post(
  "/",
  auth,
  requireRole("driver"),
  [
    body("station").notEmpty().withMessage("station is required"),
    body("fuelType")
      .notEmpty()
      .withMessage("fuelType is required")
      .isIn(["petrol", "diesel"])
      .withMessage("fuelType invalid"),
    body("requestedLiters")
      .notEmpty()
      .withMessage("requestedLiters is required")
      .isFloat({ gt: 0 })
      .withMessage("requestedLiters must be > 0"),
    body("bookingDate").notEmpty().withMessage("bookingDate is required"),
    body("timeSlot")
      .notEmpty()
      .withMessage("timeSlot is required")
      .isLength({ min: 11, max: 11 })
      .withMessage("timeSlot invalid"),
    body("notes")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("notes too long"),
  ],
  validateRequest,
  bookingController.createBooking,
);

router.get(
  "/me",
  auth,
  requireRole("driver"),
  [
    query("status")
      .optional()
      .isIn([
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "expired",
        "no_show",
      ])
      .withMessage("status invalid"),
    query("from").optional(),
    query("to").optional(),
  ],
  validateRequest,
  bookingController.getMyBookings,
);

router.get(
  "/me/:id",
  auth,
  requireRole("driver"),
  validateObjectIdParam("id"),
  bookingController.getBookingById,
);

router.patch(
  "/cancel/:id",
  auth,
  [
    validateObjectIdParam("id"),
    body("reason")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage("reason too long"),
  ],
  validateRequest,
  bookingController.cancelBooking,
);

router.get(
  "/admin/all",
  auth,
  requireRole("admin"),
  [
    query("status")
      .optional()
      .isIn([
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "expired",
        "no_show",
      ])
      .withMessage("status invalid"),
    query("station").optional(),
    query("date").optional(),
    query("city")
      .optional()
      .trim()
      .isLength({ max: 120 })
      .withMessage("city invalid"),
  ],
  validateRequest,
  bookingController.adminGetAllBookings,
);

router.post(
  "/admin/expire",
  auth,
  requireRole("admin"),
  bookingController.markExpiredBookings,
);

module.exports = router;
