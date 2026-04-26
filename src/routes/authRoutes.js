const express = require("express");
const { body } = require("express-validator");

const auth = require("../middlewares/auth");
const validateRequest = require("../middlewares/validateRequest");
const authController = require("../controllers/authController");

const router = express.Router();

router.post(
  "/register",
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("name is required")
      .isLength({ max: 120 })
      .withMessage("name too long"),
    body("phone")
      .trim()
      .notEmpty()
      .withMessage("phone is required")
      .isLength({ min: 6, max: 30 })
      .withMessage("phone invalid"),
    body("email")
      .trim()
      .notEmpty()
      .withMessage("email is required")
      .isEmail()
      .withMessage("email must be valid")
      .normalizeEmail(),
    body("password")
      .notEmpty()
      .withMessage("password is required")
      .isLength({ min: 6 })
      .withMessage("password must be at least 6 characters"),
  ],
  validateRequest,
  authController.register,
);

router.post(
  "/login",
  [
    body("email")
      .trim()
      .notEmpty()
      .withMessage("email is required")
      .isEmail()
      .withMessage("email must be valid")
      .normalizeEmail(),
    body("password").notEmpty().withMessage("password is required"),
  ],
  validateRequest,
  authController.login,
);

router.get("/me", auth, authController.me);

router.patch(
  "/change-password",
  auth,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("currentPassword is required"),
    body("newPassword")
      .notEmpty()
      .withMessage("newPassword is required")
      .isLength({ min: 6 })
      .withMessage("newPassword must be at least 6 characters"),
  ],
  validateRequest,
  authController.changePassword,
);

module.exports = router;
