const express = require("express");
const { body, query } = require("express-validator");

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const validateRequest = require("../middlewares/validateRequest");
const validateObjectIdParam = require("../middlewares/validateObjectIdParam");
const stationController = require("../controllers/stationController");

const router = express.Router();

router.get("/", stationController.getStations);

router.get(
  "/nearby",
  [
    query("city").notEmpty().withMessage("city is required"),
    query("latitude")
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage("latitude invalid"),
    query("longitude")
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage("longitude invalid"),
  ],
  validateRequest,
  stationController.getNearbyStations,
);

router.get(
  "/:id",
  validateObjectIdParam("id"),
  stationController.getStationById,
);

router.post(
  "/",
  auth,
  requireRole("admin"),
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("name is required")
      .isLength({ max: 200 })
      .withMessage("name too long"),
    body("code")
      .trim()
      .notEmpty()
      .withMessage("code is required")
      .isLength({ min: 2, max: 20 })
      .withMessage("code invalid"),
    body("location")
      .trim()
      .notEmpty()
      .withMessage("location is required")
      .isLength({ max: 200 })
      .withMessage("location invalid"),
    body("city")
      .trim()
      .notEmpty()
      .withMessage("city is required")
      .isLength({ max: 120 })
      .withMessage("city invalid"),
    body("latitude")
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage("latitude invalid"),
    body("longitude")
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage("longitude invalid"),
    body("fuelTypes")
      .optional()
      .isArray()
      .withMessage("fuelTypes must be an array"),
    body("fuelTypes.*")
      .optional()
      .isIn(["petrol", "diesel"])
      .withMessage("fuelTypes invalid"),
    body("fuelStock")
      .optional()
      .isObject()
      .withMessage("fuelStock must be an object"),
    body("fuelStock.petrol")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("fuelStock.petrol invalid"),
    body("fuelStock.diesel")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("fuelStock.diesel invalid"),
    body("status")
      .optional()
      .isIn(["open", "closed", "offline", "maintenance"])
      .withMessage("status invalid"),
  ],
  validateRequest,
  stationController.createStation,
);

router.patch(
  "/:id",
  auth,
  requireRole("admin"),
  validateObjectIdParam("id"),
  [
    body("name")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage("name too long"),
    body("code")
      .optional()
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage("code invalid"),
    body("location")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage("location invalid"),
    body("city")
      .optional()
      .trim()
      .isLength({ max: 120 })
      .withMessage("city invalid"),
    body("latitude")
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage("latitude invalid"),
    body("longitude")
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage("longitude invalid"),
    body("fuelTypes")
      .optional()
      .isArray()
      .withMessage("fuelTypes must be an array"),
    body("fuelTypes.*")
      .optional()
      .isIn(["petrol", "diesel"])
      .withMessage("fuelTypes invalid"),
    body("queueCount")
      .optional()
      .isInt({ min: 0 })
      .withMessage("queueCount invalid"),
    body("status")
      .optional()
      .isIn(["open", "closed", "offline", "maintenance"])
      .withMessage("status invalid"),
  ],
  validateRequest,
  stationController.updateStation,
);

router.patch(
  "/:id/stock",
  auth,
  requireRole("admin"),
  validateObjectIdParam("id"),
  [
    body("petrol").optional().isFloat({ min: 0 }).withMessage("petrol invalid"),
    body("diesel").optional().isFloat({ min: 0 }).withMessage("diesel invalid"),
  ],
  validateRequest,
  stationController.updateFuelStock,
);

router.patch(
  "/:id/status",
  auth,
  requireRole("admin"),
  validateObjectIdParam("id"),
  [
    body("status")
      .notEmpty()
      .withMessage("status is required")
      .isIn(["open", "closed", "offline", "maintenance"])
      .withMessage("status invalid"),
  ],
  validateRequest,
  stationController.changeStationStatus,
);

router.delete(
  "/:id",
  auth,
  requireRole("admin"),
  validateObjectIdParam("id"),
  stationController.deleteStation,
);

module.exports = router;
