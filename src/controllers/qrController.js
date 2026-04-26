const QRCode = require("../models/QRCode");
const Booking = require("../models/Booking");
const Quota = require("../models/Quota");

const {
  generateSecureToken,
  generateQRCodeImage,
  isWithinAllowedWindow,
} = require("../utils/qrUtils");

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return String(req.ip || "");
};

const getDeviceInfo = (req) => {
  return String(req.get("user-agent") || "");
};

const tryGenerateUniqueToken = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateSecureToken(32);
    const exists = await QRCode.exists({ token });
    if (!exists) return token;
  }

  return generateSecureToken(48);
};

const generateQR = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ _id: bookingId, driver: driverId });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        data: {},
      });
    }

    if (booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "QR can only be generated for confirmed bookings",
        data: {},
      });
    }

    const earlyWindowMinutes = Number(process.env.QR_EARLY_WINDOW_MINUTES);
    const windowCheck = isWithinAllowedWindow(
      booking.bookingDate,
      booking.timeSlot,
      {
        earlyMinutes: Number.isFinite(earlyWindowMinutes)
          ? earlyWindowMinutes
          : 15,
      },
    );

    if (!windowCheck.ok) {
      return res.status(400).json({
        success: false,
        message: windowCheck.message,
        data: {},
      });
    }

    const now = new Date();
    const expiresSeconds = Number(process.env.QR_EXPIRES_SECONDS);
    const ttlMs =
      Number.isFinite(expiresSeconds) && expiresSeconds > 0
        ? expiresSeconds * 1000
        : 2 * 60 * 1000;

    const regenCooldownSeconds = Number(process.env.QR_REGEN_COOLDOWN_SECONDS);
    const cooldownMs =
      Number.isFinite(regenCooldownSeconds) && regenCooldownSeconds > 0
        ? regenCooldownSeconds * 1000
        : 30 * 1000;

    let qr = await QRCode.findOne({ booking: booking._id });

    if (qr) {
      if (qr.used) {
        return res.status(400).json({
          success: false,
          message: "This booking QR has already been used",
          data: {},
        });
      }

      const lastGenAt = qr.updatedAt || qr.createdAt;
      if (
        lastGenAt &&
        now.getTime() - new Date(lastGenAt).getTime() < cooldownMs
      ) {
        return res.status(429).json({
          success: false,
          message: "Please wait before regenerating QR",
          data: {},
        });
      }
    }

    const token = await tryGenerateUniqueToken();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const codeImage = await generateQRCodeImage(token);

    const meta = {
      ipAddress: getClientIp(req),
      deviceInfo: getDeviceInfo(req),
    };

    if (!qr) {
      qr = new QRCode({
        booking: booking._id,
        driver: driverId,
        token,
        codeImage,
        expiresAt,
        used: false,
        usedAt: null,
        validatedAt: null,
        station: booking.station || null,
        attendant: null,
        meta,
      });
    } else {
      qr.driver = driverId;
      qr.token = token;
      qr.codeImage = codeImage;
      qr.expiresAt = expiresAt;
      qr.used = false;
      qr.usedAt = null;
      qr.validatedAt = null;
      qr.station = booking.station || null;
      qr.attendant = null;
      qr.meta = meta;
    }

    await qr.save();

    return res.status(200).json({
      success: true,
      message: "QR generated",
      data: {
        token: qr.token,
        expiresAt: qr.expiresAt,
        codeImage: qr.codeImage,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyActiveQR = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ _id: bookingId, driver: driverId });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        data: {},
      });
    }

    const now = new Date();

    const qr = await QRCode.findOne({
      booking: booking._id,
      driver: driverId,
      used: false,
      expiresAt: { $gt: now },
    }).select("token codeImage expiresAt used validatedAt createdAt updatedAt");

    if (!qr) {
      return res.status(404).json({
        success: false,
        message: "Active QR not found",
        data: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Active QR",
      data: { qr },
    });
  } catch (err) {
    return next(err);
  }
};

const validateQR = async (req, res, next) => {
  try {
    const { token } = req.body;
    const normalizedToken = String(token || "").trim();

    const qr = await QRCode.findOne({ token: normalizedToken }).populate({
      path: "booking",
      populate: [
        { path: "driver", select: "name phone email" },
        { path: "vehicle", select: "plateNumber type model color" },
        { path: "station", select: "name code city location status" },
      ],
    });

    if (!qr) {
      return res.status(404).json({
        success: false,
        message: "QR token not found",
        data: {},
      });
    }

    if (qr.used) {
      return res.status(400).json({
        success: false,
        message: "QR already used",
        data: {},
      });
    }

    const now = new Date();
    if (qr.expiresAt && qr.expiresAt.getTime() <= now.getTime()) {
      return res.status(400).json({
        success: false,
        message: "QR expired",
        data: {},
      });
    }

    const booking = qr.booking;
    if (!booking) {
      return res.status(400).json({
        success: false,
        message: "QR booking not found",
        data: {},
      });
    }

    if (booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Booking is not confirmed",
        data: {},
      });
    }

    const quota = await Quota.findOne({ driver: booking.driver }).select(
      "remainingLiters monthlyLimit usedLiters",
    );

    qr.validatedAt = now;
    qr.station = booking.station || qr.station || null;
    qr.attendant = req.user && req.user._id ? req.user._id : qr.attendant;
    qr.meta = {
      ipAddress: getClientIp(req),
      deviceInfo: getDeviceInfo(req),
    };

    await qr.save();

    return res.status(200).json({
      success: true,
      message: "QR validated",
      data: {
        booking: {
          id: booking._id,
          bookingDate: booking.bookingDate,
          timeSlot: booking.timeSlot,
          queueNumber: booking.queueNumber,
          fuelType: booking.fuelType,
          approvedLiters: booking.approvedLiters,
          requestedLiters: booking.requestedLiters,
          status: booking.status,
        },
        driver: booking.driver
          ? {
              id: booking.driver._id,
              name: booking.driver.name,
              phone: booking.driver.phone,
              email: booking.driver.email,
            }
          : null,
        vehicle: booking.vehicle
          ? {
              id: booking.vehicle._id,
              plateNumber: booking.vehicle.plateNumber,
              type: booking.vehicle.type,
              model: booking.vehicle.model,
              color: booking.vehicle.color,
            }
          : null,
        station: booking.station
          ? {
              id: booking.station._id,
              name: booking.station.name,
              code: booking.station.code,
              city: booking.station.city,
              location: booking.station.location,
              status: booking.station.status,
            }
          : null,
        quota: quota
          ? {
              remainingLiters: quota.remainingLiters,
              monthlyLimit: quota.monthlyLimit,
              usedLiters: quota.usedLiters,
            }
          : null,
        qr: {
          expiresAt: qr.expiresAt,
          validatedAt: qr.validatedAt,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const invalidateQR = async (req, res, next) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId).select("driver");
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        data: {},
      });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = String(booking.driver) === String(req.user._id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
        data: {},
      });
    }

    const qr = await QRCode.findOne({ booking: booking._id });
    if (!qr) {
      return res.status(404).json({
        success: false,
        message: "QR not found",
        data: {},
      });
    }

    if (qr.used) {
      return res.status(400).json({
        success: false,
        message: "Cannot invalidate a used QR",
        data: {},
      });
    }

    await QRCode.deleteOne({ _id: qr._id });

    return res.status(200).json({
      success: true,
      message: "QR invalidated",
      data: {},
    });
  } catch (err) {
    return next(err);
  }
};

const cleanupExpiredQR = async (req, res, next) => {
  try {
    const now = new Date();

    const result = await QRCode.deleteMany({
      expiresAt: { $lte: now },
    });

    return res.status(200).json({
      success: true,
      message: "Expired QR cleaned",
      data: {
        deletedCount: result.deletedCount || 0,
      },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  generateQR,
  getMyActiveQR,
  validateQR,
  invalidateQR,
  cleanupExpiredQR,
};
