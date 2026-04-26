const mongoose = require("mongoose");

const DRIVER_PROFILE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
];

const driverProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    nationalId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    licenseNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    photo: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: DRIVER_PROFILE_STATUSES,
      default: "pending",
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("DriverProfile", driverProfileSchema);
module.exports.DRIVER_PROFILE_STATUSES = DRIVER_PROFILE_STATUSES;
