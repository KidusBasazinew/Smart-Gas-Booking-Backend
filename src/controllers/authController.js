const User = require("../models/User");
const { signToken } = require("../utils/jwt");
const { hashPassword, comparePassword } = require("../utils/password");

const register = async (req, res, next) => {
  try {
    const { name, phone, email, password } = req.body;

    const normalizedEmail = String(email || "")
      .toLowerCase()
      .trim();
    const normalizedPhone = String(phone || "").trim();

    const existing = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: normalizedPhone }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email or phone",
      });
    }

    const hashed = await hashPassword(password);

    const user = await User.create({
      name: String(name).trim(),
      phone: normalizedPhone,
      email: normalizedEmail,
      password: hashed,
      role: "driver",
    });

    const token = signToken({ id: user._id, role: user.role });

    return res.status(201).json({
      success: true,
      message: "Registered successfully",
      data: {
        token,
        user,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = String(email || "")
      .toLowerCase()
      .trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password",
    );
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "User is blocked",
      });
    }

    const ok = await comparePassword(password, user.password);
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    user.password = undefined;

    const token = signToken({ id: user._id, role: user.role });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const me = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const userWithPassword = await User.findById(req.user._id).select(
      "+password",
    );
    if (!userWithPassword) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ok = await comparePassword(
      currentPassword,
      userWithPassword.password,
    );
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    userWithPassword.password = await hashPassword(newPassword);
    await userWithPassword.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  login,
  me,
  changePassword,
};
