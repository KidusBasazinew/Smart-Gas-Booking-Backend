const mongoose = require("mongoose");

const VEHICLE_TYPES = ["taxi", "bus", "private", "truck"];

const quotaSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    vehicleType: {
      type: String,
      enum: VEHICLE_TYPES,
      required: true,
      index: true,
    },
    monthlyLimit: {
      type: Number,
      required: true,
      min: 0,
    },
    usedLiters: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingLiters: {
      type: Number,
      default: 0,
      min: 0,
    },
    resetDate: {
      type: Date,
      default: null,
      index: true,
    },
    month: {
      type: Number,
      default: null,
      min: 1,
      max: 12,
      index: true,
    },
    year: {
      type: Number,
      default: null,
      index: true,
    },
    isManualOverride: {
      type: Boolean,
      default: false,
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

quotaSchema.pre("validate", function (next) {
  try {
    const monthlyLimit = Number(this.monthlyLimit);
    const usedLiters = Number(this.usedLiters);

    const safeMonthlyLimit = Number.isFinite(monthlyLimit)
      ? Math.max(0, monthlyLimit)
      : 0;
    const safeUsed = Number.isFinite(usedLiters) ? Math.max(0, usedLiters) : 0;

    this.monthlyLimit = safeMonthlyLimit;
    this.usedLiters = safeUsed;

    const remaining = safeMonthlyLimit - safeUsed;
    this.remainingLiters = Math.max(0, remaining);

    if (!this.month || !this.year) {
      const now = new Date();
      this.month = now.getMonth() + 1;
      this.year = now.getFullYear();
    }

    if (!this.resetDate) {
      const now = new Date();
      this.resetDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1,
        0,
        0,
        0,
        0,
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

module.exports = mongoose.model("Quota", quotaSchema);
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
