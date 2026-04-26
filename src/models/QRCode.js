const mongoose = require("mongoose");

const qrCodeSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    codeImage: {
      type: String,
      default: "",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    used: {
      type: Boolean,
      default: false,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    validatedAt: {
      type: Date,
      default: null,
    },
    station: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Station",
      default: null,
      index: true,
    },
    attendant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    meta: {
      ipAddress: {
        type: String,
        default: "",
        trim: true,
        maxlength: 200,
      },
      deviceInfo: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
      },
    },
  },
  {
    timestamps: true,
  },
);

qrCodeSchema.index({ token: 1 });
qrCodeSchema.index({ expiresAt: 1 });
qrCodeSchema.index({ booking: 1 });

module.exports = mongoose.model("QRCode", qrCodeSchema);
