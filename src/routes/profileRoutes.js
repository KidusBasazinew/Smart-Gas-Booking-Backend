const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const driverProfileController = require("../controllers/driverProfileController");

const router = express.Router();

router.post(
  "/me",
  auth,
  requireRole("driver"),
  [
    body("nationalId")
      .optional()
      .trim()
      .isLength({ min: 3, max: 60 })
      .withMessage("nationalId invalid"),
    body("licenseNumber")
      .optional()
      .trim()
      .isLength({ min: 3, max: 60 })
      .withMessage("licenseNumber invalid"),
    body("photo")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("photo invalid"),
    body("address")
      .optional()
      .trim()
      .isLength({ max: 300 })
      .withMessage("address invalid"),
    body("city")
      .optional()
      .trim()
      .isLength({ max: 120 })
      .withMessage("city invalid"),
  ],
  validateRequest,
  driverProfileController.createOrUpdateProfile,
);

router.get(
  "/me",
  auth,
  requireRole("driver"),
  driverProfileController.getMyProfile,
);

router.get(
  "/pending",
  auth,
  requireRole("admin"),
  driverProfileController.getPendingDrivers,
);

router.patch(
  "/approve/:userId",
  auth,
  requireRole("admin"),
  validateObjectIdParam("userId"),
  driverProfileController.approveDriver,
);

router.patch(
  "/reject/:userId",
  auth,
  requireRole("admin"),
  validateObjectIdParam("userId"),
  driverProfileController.rejectDriver,
);

router.patch(
  "/suspend/:userId",
  auth,
  requireRole("admin"),
  validateObjectIdParam("userId"),
  driverProfileController.suspendDriver,
);

module.exports = router;
