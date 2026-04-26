const Booking = require("../models/Booking");
const Station = require("../models/Station");
const Vehicle = require("../models/Vehicle");
const DriverProfile = require("../models/DriverProfile");
const Quota = require("../models/Quota");
const {
  calculateRemaining,
  clampNonNegative,
} = require("../services/quotaService");
const { getSlotStartEnd, isBeforeCutoff } = require("../utils/timeSlot");
const { isValidObjectId } = require("../utils/objectId");

const normalizeDayStart = (d) => {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
};

const normalizeDayEnd = (d) => {
  const start = normalizeDayStart(d);
  if (!start) return null;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    23,
    59,
    59,
    999,
  );
};

const getNextQueueNumber = async ({ stationId, bookingDate, timeSlot }) => {
  const dayStart = normalizeDayStart(bookingDate);
  const dayEnd = normalizeDayEnd(bookingDate);

  const last = await Booking.findOne({
    station: stationId,
    bookingDate: { $gte: dayStart, $lte: dayEnd },
    timeSlot,
  }).sort({ queueNumber: -1 });

  const lastNum = last && last.queueNumber ? Number(last.queueNumber) : 0;
  return lastNum + 1;
};

const createBooking = async (req, res, next) => {
  try {
    const driverId = req.user._id;

    if (!req.user.isApproved) {
      return res.status(403).json({
        success: false,
        message: "Driver is not approved",
      });
    }

    const profile = await DriverProfile.findOne({
      user: driverId,
      status: "approved",
    });
    if (!profile) {
      return res.status(403).json({
        success: false,
        message: "Driver profile is not approved",
      });
    }

    const activeVehicle = await Vehicle.findOne({
      driver: driverId,
      isActive: true,
    });
    if (!activeVehicle) {
      return res.status(400).json({
        success: false,
        message: "Active vehicle not found",
      });
    }

    const quota = await Quota.findOne({ driver: driverId });
    if (!quota) {
      return res.status(400).json({
        success: false,
        message: "Quota not initialized",
      });
    }

    const activeBooking = await Booking.findOne({
      driver: driverId,
      status: { $in: ["pending", "confirmed"] },
    });

    if (activeBooking) {
      return res.status(409).json({
        success: false,
        message: "You already have an active booking",
      });
    }

    const { station, fuelType, requestedLiters, bookingDate, timeSlot, notes } =
      req.body;

    if (!isValidObjectId(station)) {
      return res.status(400).json({
        success: false,
        message: "Invalid station",
      });
    }

    const reqLiters = Number(requestedLiters);
    if (!Number.isFinite(reqLiters) || reqLiters <= 0) {
      return res.status(422).json({
        success: false,
        message: "requestedLiters must be a number > 0",
      });
    }

    const dayStart = normalizeDayStart(bookingDate);
    if (!dayStart) {
      return res.status(422).json({
        success: false,
        message: "Invalid bookingDate",
      });
    }

    const slot = getSlotStartEnd(dayStart, timeSlot);
    if (!slot) {
      return res.status(422).json({
        success: false,
        message: "Invalid timeSlot",
      });
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );

    if (!dayStart || dayStart < todayStart) {
      return res.status(400).json({
        success: false,
        message: "Booking date cannot be in the past",
      });
    }

    if (slot.end <= now) {
      return res.status(400).json({
        success: false,
        message: "Selected time slot has already passed",
      });
    }

    const stationDoc = await Station.findOne({
      _id: station,
      isDeleted: false,
    });
    if (!stationDoc) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    if (stationDoc.status !== "open") {
      return res.status(400).json({
        success: false,
        message: "Station is not open",
      });
    }

    if (
      !Array.isArray(stationDoc.fuelTypes) ||
      !stationDoc.fuelTypes.includes(fuelType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Station does not support this fuel type",
      });
    }

    const stock = stationDoc.fuelStock && stationDoc.fuelStock[fuelType];
    if (!Number.isFinite(stock) || stock <= 0) {
      return res.status(400).json({
        success: false,
        message: "Fuel out of stock",
      });
    }

    const remaining = clampNonNegative(quota.remainingLiters);
    const approvedLiters = Math.min(reqLiters, remaining);

    if (approvedLiters <= 0) {
      return res.status(400).json({
        success: false,
        message: "Insufficient quota remaining",
      });
    }

    const queueNumber = await getNextQueueNumber({
      stationId: stationDoc._id,
      bookingDate: dayStart,
      timeSlot: slot.parsed.normalized,
    });

    const booking = await Booking.create({
      driver: driverId,
      station: stationDoc._id,
      vehicle: activeVehicle._id,
      fuelType,
      requestedLiters: reqLiters,
      approvedLiters,
      bookingDate: dayStart,
      timeSlot: slot.parsed.normalized,
      queueNumber,
      status: "confirmed",
      notes: notes ? String(notes).trim() : "",
    });

    quota.usedLiters = clampNonNegative(quota.usedLiters + approvedLiters);
    quota.remainingLiters = calculateRemaining(
      quota.monthlyLimit,
      quota.usedLiters,
    );
    await quota.save();

    const populated = await Booking.findById(booking._id)
      .populate("station", "name code city location status")
      .populate("vehicle", "plateNumber type model color isActive");

    return res.status(201).json({
      success: true,
      message: "Booking created",
      data: { booking: populated },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { status, from, to } = req.query;

    const filter = { driver: driverId };

    if (status) filter.status = String(status).trim();

    if (from || to) {
      const fromDate = from ? normalizeDayStart(from) : null;
      const toDate = to ? normalizeDayEnd(to) : null;

      filter.bookingDate = {};
      if (fromDate) filter.bookingDate.$gte = fromDate;
      if (toDate) filter.bookingDate.$lte = toDate;

      if (Object.keys(filter.bookingDate).length === 0)
        delete filter.bookingDate;
    }

    const bookings = await Booking.find(filter)
      .populate("station", "name code city location status")
      .populate("vehicle", "plateNumber type")
      .sort({ bookingDate: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { bookings },
    });
  } catch (err) {
    return next(err);
  }
};

const getBookingById = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { id } = req.params;

    const booking = await Booking.findOne({ _id: id, driver: driverId })
      .populate("station", "name code city location status")
      .populate("vehicle", "plateNumber type model color isActive");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { booking },
    });
  } catch (err) {
    return next(err);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = String(booking.driver) === String(req.user._id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Only pending/confirmed bookings can be cancelled",
      });
    }

    if (!isAdmin) {
      const slot = getSlotStartEnd(booking.bookingDate, booking.timeSlot);
      if (!slot) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking slot",
        });
      }

      const allowed = isBeforeCutoff(slot.start, 60);
      if (!allowed) {
        return res.status(400).json({
          success: false,
          message:
            "Cancellation is only allowed at least 1 hour before slot start",
        });
      }
    }

    booking.status = "cancelled";
    booking.cancelledBy = req.user._id;
    await booking.save();

    const quota = await Quota.findOne({ driver: booking.driver });
    if (quota) {
      quota.usedLiters = clampNonNegative(
        quota.usedLiters - clampNonNegative(booking.approvedLiters),
      );
      quota.remainingLiters = calculateRemaining(
        quota.monthlyLimit,
        quota.usedLiters,
      );
      await quota.save();
    }

    return res.status(200).json({
      success: true,
      message: "Booking cancelled",
    });
  } catch (err) {
    return next(err);
  }
};

const adminGetAllBookings = async (req, res, next) => {
  try {
    const { status, station, date, city } = req.query;

    const filter = {};

    if (status) filter.status = String(status).trim();

    if (station) {
      if (!isValidObjectId(station)) {
        return res.status(400).json({
          success: false,
          message: "Invalid station",
        });
      }
      filter.station = station;
    }

    if (date) {
      const start = normalizeDayStart(date);
      const end = normalizeDayEnd(date);
      if (start && end) {
        filter.bookingDate = { $gte: start, $lte: end };
      }
    }

    if (city) {
      const stations = await Station.find({
        city: String(city).trim(),
        isDeleted: false,
      }).select("_id");
      const ids = stations.map((s) => s._id);

      if (filter.station) {
        filter.station = {
          $in: ids.filter((id) => String(id) === String(filter.station)),
        };
      } else {
        filter.station = { $in: ids };
      }
    }

    const bookings = await Booking.find(filter)
      .populate("driver", "name phone email")
      .populate("station", "name code city location")
      .populate("vehicle", "plateNumber type")
      .sort({ bookingDate: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { bookings },
    });
  } catch (err) {
    return next(err);
  }
};

const markExpiredBookings = async (req, res, next) => {
  try {
    const now = new Date();

    const candidates = await Booking.find({
      status: { $in: ["pending", "confirmed"] },
    });

    let expiredCount = 0;

    for (const booking of candidates) {
      const slot = getSlotStartEnd(booking.bookingDate, booking.timeSlot);
      if (!slot) continue;

      if (slot.end <= now) {
        booking.status = "expired";
        await booking.save();

        const quota = await Quota.findOne({ driver: booking.driver });
        if (quota) {
          quota.usedLiters = clampNonNegative(
            quota.usedLiters - clampNonNegative(booking.approvedLiters),
          );
          quota.remainingLiters = calculateRemaining(
            quota.monthlyLimit,
            quota.usedLiters,
          );
          await quota.save();
        }

        expiredCount += 1;
      }
    }

    return res.status(200).json({
      success: true,
      message: "Expired bookings processed",
      data: { expiredCount },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  adminGetAllBookings,
  markExpiredBookings,
};
