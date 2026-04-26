const mongoose = require("mongoose");

const FUEL_TYPES = ["petrol", "diesel"];
const STATION_STATUSES = ["open", "closed", "offline", "maintenance"];

const stationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    fuelTypes: {
      type: [String],
      enum: FUEL_TYPES,
      default: [],
      index: true,
    },
    fuelStock: {
      petrol: {
        type: Number,
        default: 0,
        min: 0,
      },
      diesel: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    queueCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: STATION_STATUSES,
      default: "open",
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

stationSchema.index({ city: 1, status: 1 });
stationSchema.index({ location: 1, status: 1 });

module.exports = mongoose.model("Station", stationSchema);
module.exports.FUEL_TYPES = FUEL_TYPES;
module.exports.STATION_STATUSES = STATION_STATUSES;
