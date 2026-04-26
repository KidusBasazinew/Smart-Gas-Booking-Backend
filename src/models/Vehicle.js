const mongoose = require("mongoose");

const VEHICLE_TYPES = ["taxi", "bus", "private", "truck"];

const vehicleSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    plateNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: VEHICLE_TYPES,
      required: true,
      index: true,
    },
    model: {
      type: String,
      default: "",
      trim: true,
    },
    color: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Vehicle", vehicleSchema);
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
