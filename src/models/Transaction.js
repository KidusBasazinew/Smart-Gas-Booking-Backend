const mongoose = require("mongoose");

const FUEL_TYPES = ["petrol", "diesel"];
const PAYMENT_METHODS = ["cash", "telebirr", "card", "other"];
const TRANSACTION_STATUSES = ["completed", "failed", "reversed"];

const transactionSchema = new mongoose.Schema(
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
    attendant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    qrCode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QRCode",
      default: null,
      index: true,
    },
    liters: {
      type: Number,
      required: true,
      min: 0.01,
    },
    fuelType: {
      type: String,
      enum: FUEL_TYPES,
      required: true,
      index: true,
    },
    pricePerLiter: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "cash",
      index: true,
    },
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    pumpNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 50,
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      default: "completed",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    completedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

transactionSchema.index({ receiptNumber: 1 });
transactionSchema.index({ station: 1, completedAt: -1 });
transactionSchema.index({ driver: 1, completedAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
module.exports.FUEL_TYPES = FUEL_TYPES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.TRANSACTION_STATUSES = TRANSACTION_STATUSES;
