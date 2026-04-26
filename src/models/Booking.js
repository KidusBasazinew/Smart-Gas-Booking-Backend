const mongoose = require("mongoose");

const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "expired",
  "no_show",
];

const FUEL_TYPES = ["petrol", "diesel"];

const bookingSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    station: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Station",
      required: true,
      index: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    fuelType: {
      type: String,
      enum: FUEL_TYPES,
      required: true,
      index: true,
    },
    requestedLiters: {
      type: Number,
      required: true,
      min: 0.1,
    },
    approvedLiters: {
      type: Number,
      default: 0,
      min: 0,
    },
    bookingDate: {
      type: Date,
      required: true,
      index: true,
    },
    timeSlot: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    queueNumber: {
      type: Number,
      default: null,
      min: 1,
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

bookingSchema.index({ driver: 1, status: 1 });
bookingSchema.index({ station: 1, bookingDate: 1, timeSlot: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
module.exports.FUEL_TYPES = FUEL_TYPES;
