const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const vehicleController = require("../controllers/vehicleController");

const router = express.Router();

router.post(
  "/",
  auth,
  requireRole("driver"),
  [
    body("plateNumber")
      .trim()
      .notEmpty()
      .withMessage("plateNumber is required")
      .isLength({ min: 3, max: 20 })
      .withMessage("plateNumber invalid"),
    body("type")
      .notEmpty()
      .withMessage("type is required")
      .isIn(["taxi", "bus", "private", "truck"])
      .withMessage("type invalid"),
    body("model")
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage("model invalid"),
    body("color")
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage("color invalid"),
  ],
  validateRequest,
  vehicleController.addVehicle,
);

router.get("/", auth, requireRole("driver"), vehicleController.getMyVehicles);

router.patch(
  "/:id",
  auth,
  requireRole("driver"),
  validateObjectIdParam("id"),
  [
    body("plateNumber")
      .optional()
      .trim()
      .isLength({ min: 3, max: 20 })
      .withMessage("plateNumber invalid"),
    body("type")
      .optional()
      .isIn(["taxi", "bus", "private", "truck"])
      .withMessage("type invalid"),
    body("model")
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage("model invalid"),
    body("color")
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage("color invalid"),
  ],
  validateRequest,
  vehicleController.updateVehicle,
);

router.delete(
  "/:id",
  auth,
  requireRole("driver"),
  validateObjectIdParam("id"),
  vehicleController.deleteVehicle,
);

router.patch(
  "/:id/active",
  auth,
  requireRole("driver"),
  validateObjectIdParam("id"),
  vehicleController.setActiveVehicle,
);

module.exports = router;
