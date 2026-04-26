const mongoose = require("mongoose");

const User = require("../models/User");
const DriverProfile = require("../models/DriverProfile");
const Station = require("../models/Station");
const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const QRCode = require("../models/QRCode");
const Vehicle = require("../models/Vehicle");
const Quota = require("../models/Quota");

const {
  getCurrentPeriod,
  getNextResetDate,
  calculateRemaining,
  clampNonNegative,
} = require("../services/quotaService");

const { getAdminAnalytics } = require("../services/analyticsService");

const LOW_STOCK_THRESHOLD_LITERS = 200;

const normalizeDayStart = (d) => {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
};

const normalizeDayEnd = (d) => {
  const start = normalizeDayStart(d);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
};

const parsePageParams = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getDashboardSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = normalizeDayStart(now);
    const todayEnd = normalizeDayEnd(now);

    const [
      totalUsers,
      totalDrivers,
      totalAttendants,
      totalStations,
      activeStations,
      todayBookings,
      todayTransactions,
      litersAgg,
      pendingApprovals,
      activeQRCodes,
      lowStockStationsCount,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "driver" }),
      User.countDocuments({ role: "attendant" }),
      Station.countDocuments({ isDeleted: { $ne: true } }),
      Station.countDocuments({ isDeleted: { $ne: true }, status: "open" }),
      Booking.countDocuments({ bookingDate: { $gte: todayStart, $lte: todayEnd } }),
      Transaction.countDocuments({
        status: "completed",
        completedAt: { $gte: todayStart, $lte: todayEnd },
      }),
      Transaction.aggregate([
        {
          $match: {
            status: "completed",
            completedAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        { $group: { _id: null, liters: { $sum: "$liters" } } },
        { $project: { _id: 0, liters: 1 } },
      ]),
      DriverProfile.countDocuments({ status: "pending" }),
      QRCode.countDocuments({ used: false, expiresAt: { $gt: now } }),
      Station.countDocuments({
        isDeleted: { $ne: true },
        $or: [
          { "fuelStock.petrol": { $lt: LOW_STOCK_THRESHOLD_LITERS } },
          { "fuelStock.diesel": { $lt: LOW_STOCK_THRESHOLD_LITERS } },
        ],
      }),
    ]);

    const litersDispensedToday =
      Array.isArray(litersAgg) && litersAgg[0] && Number.isFinite(litersAgg[0].liters)
        ? litersAgg[0].liters
        : 0;

    return res.status(200).json({
      success: true,
      message: "Dashboard summary",
      data: {
        totalUsers,
        totalDrivers,
        totalAttendants,
        totalStations,
        activeStations,
        todayBookings,
        todayTransactions,
        litersDispensedToday,
        pendingApprovals,
        activeQRCodes,
        lowStockStationsCount,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getRecentActivity = async (req, res, next) => {
  try {
    const [bookings, transactions, approvals, reversals] = await Promise.all([
      Booking.find({})
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("driver", "name phone email")
        .populate("station", "name code city")
        .lean(),
      Transaction.find({ status: "completed" })
        .sort({ completedAt: -1, createdAt: -1 })
        .limit(20)
        .populate("driver", "name phone email")
        .populate("station", "name code city")
        .populate("attendant", "name phone email")
        .lean(),
      DriverProfile.find({ status: { $in: ["approved", "rejected"] } })
        .sort({ approvedAt: -1, updatedAt: -1 })
        .limit(20)
        .populate("user", "name phone email")
        .populate("approvedBy", "name phone email")
        .lean(),
      Transaction.find({ status: "reversed" })
        .sort({ updatedAt: -1 })
        .limit(20)
        .populate("driver", "name phone email")
        .populate("station", "name code city")
        .populate("attendant", "name phone email")
        .lean(),
    ]);

    const items = [];

    for (const b of bookings) {
      items.push({
        type: "booking",
        timestamp: b.createdAt || b.bookingDate,
        refId: b._id,
        data: {
          status: b.status,
          bookingDate: b.bookingDate,
          timeSlot: b.timeSlot,
          fuelType: b.fuelType,
          approvedLiters: b.approvedLiters,
          driver: b.driver,
          station: b.station,
        },
      });
    }

    for (const t of transactions) {
      items.push({
        type: "transaction",
        timestamp: t.completedAt || t.createdAt,
        refId: t._id,
        data: {
          status: t.status,
          receiptNumber: t.receiptNumber,
          liters: t.liters,
          fuelType: t.fuelType,
          totalAmount: t.totalAmount,
          paymentMethod: t.paymentMethod,
          driver: t.driver,
          station: t.station,
          attendant: t.attendant,
        },
      });
    }

    for (const a of approvals) {
      items.push({
        type: "approval",
        timestamp: a.approvedAt || a.updatedAt || a.createdAt,
        refId: a._id,
        data: {
          status: a.status,
          user: a.user,
          approvedBy: a.approvedBy,
        },
      });
    }

    for (const r of reversals) {
      items.push({
        type: "reversal",
        timestamp: r.updatedAt || r.completedAt || r.createdAt,
        refId: r._id,
        data: {
          status: r.status,
          receiptNumber: r.receiptNumber,
          liters: r.liters,
          fuelType: r.fuelType,
          driver: r.driver,
          station: r.station,
          attendant: r.attendant,
        },
      });
    }

    items.sort((a, b) => {
      const at = new Date(a.timestamp || 0).getTime();
      const bt = new Date(b.timestamp || 0).getTime();
      return bt - at;
    });

    const recent = items.slice(0, 20);

    return res.status(200).json({
      success: true,
      message: "Recent activity",
      data: { items: recent },
    });
  } catch (err) {
    return next(err);
  }
};

const getUsers = async (req, res, next) => {
  try {
    const { role, approved, blocked, search } = req.query;
    const { page, limit, skip } = parsePageParams(req.query);

    const filter = {};
    if (role) filter.role = String(role).trim();

    if (approved !== undefined) {
      const val = String(approved).toLowerCase();
      if (val === "true" || val === "false") filter.isApproved = val === "true";
    }

    if (blocked !== undefined) {
      const val = String(blocked).toLowerCase();
      if (val === "true" || val === "false") filter.isBlocked = val === "true";
    }

    if (search) {
      const q = String(search).trim();
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
      }
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name phone email role isApproved isBlocked createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      message: "Users",
      data: {
        page,
        limit,
        total,
        totalPages,
        users,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isApproved, isBlocked, role } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: {},
      });
    }

    if (isApproved !== undefined) user.isApproved = Boolean(isApproved);
    if (isBlocked !== undefined) user.isBlocked = Boolean(isBlocked);
    if (role !== undefined) user.role = String(role).trim();

    await user.save();

    return res.status(200).json({
      success: true,
      message: "User updated",
      data: { user },
    });
  } catch (err) {
    return next(err);
  }
};

const getPendingDrivers = async (req, res, next) => {
  try {
    const profiles = await DriverProfile.find({ status: "pending" })
      .populate("user", "name phone email role isApproved isBlocked")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Pending drivers",
      data: { profiles },
    });
  } catch (err) {
    return next(err);
  }
};

const approveDriver = async (req, res, next) => {
  try {
    const { id } = req.params;

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: {},
      });
    }

    if (targetUser.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers can be approved",
        data: {},
      });
    }

    const profile = await DriverProfile.findOne({ user: id });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
        data: {},
      });
    }

    profile.status = "approved";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();

    targetUser.isApproved = true;
    targetUser.isBlocked = false;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Driver approved",
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

const rejectDriver = async (req, res, next) => {
  try {
    const { id } = req.params;

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: {},
      });
    }

    if (targetUser.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers can be rejected",
        data: {},
      });
    }

    const profile = await DriverProfile.findOne({ user: id });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
        data: {},
      });
    }

    profile.status = "rejected";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();

    targetUser.isApproved = false;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Driver rejected",
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

const getStationsAdmin = async (req, res, next) => {
  try {
    const { status, city, lowStock } = req.query;

    const filter = { isDeleted: { $ne: true } };

    if (status) filter.status = String(status).trim();
    if (city) filter.city = String(city).trim();

    if (String(lowStock).toLowerCase() === "true") {
      filter.$or = [
        { "fuelStock.petrol": { $lt: LOW_STOCK_THRESHOLD_LITERS } },
        { "fuelStock.diesel": { $lt: LOW_STOCK_THRESHOLD_LITERS } },
      ];
    }

    const stations = await Station.find(filter)
      .select("name code location city latitude longitude fuelTypes fuelStock queueCount status createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Stations",
      data: { stations },
    });
  } catch (err) {
    return next(err);
  }
};

const updateStationAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const station = await Station.findById(id);
    if (!station || station.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
        data: {},
      });
    }

    const allowed = [
      "name",
      "code",
      "location",
      "city",
      "latitude",
      "longitude",
      "fuelTypes",
      "fuelStock",
      "queueCount",
      "status",
      "isDeleted",
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        station[key] = req.body[key];
      }
    }

    await station.save();

    return res.status(200).json({
      success: true,
      message: "Station updated",
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const getBookingsAdmin = async (req, res, next) => {
  try {
    const { status, date, station, driver } = req.query;
    const { page, limit, skip } = parsePageParams(req.query);

    const filter = {};
    if (status) filter.status = String(status).trim();

    if (station) filter.station = station;
    if (driver) filter.driver = driver;

    if (date) {
      const start = normalizeDayStart(date);
      const end = normalizeDayEnd(date);
      if (start && end) {
        filter.bookingDate = { $gte: start, $lte: end };
      }
    }

    const [total, bookings] = await Promise.all([
      Booking.countDocuments(filter),
      Booking.find(filter)
        .sort({ bookingDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("driver", "name phone email")
        .populate("station", "name code city location status")
        .populate("vehicle", "plateNumber type")
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      message: "Bookings",
      data: { page, limit, total, totalPages, bookings },
    });
  } catch (err) {
    return next(err);
  }
};

const cancelBookingAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        data: {},
      });
    }

    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Only pending/confirmed bookings can be cancelled",
        data: {},
      });
    }

    booking.status = "cancelled";
    booking.cancelledBy = req.user._id;
    await booking.save();

    const quota = await Quota.findOne({ driver: booking.driver });
    if (quota) {
      quota.usedLiters = clampNonNegative(
        quota.usedLiters - clampNonNegative(booking.approvedLiters),
      );
      quota.remainingLiters = calculateRemaining(quota.monthlyLimit, quota.usedLiters);
      await quota.save();
    }

    return res.status(200).json({
      success: true,
      message: "Booking cancelled",
      data: {},
    });
  } catch (err) {
    return next(err);
  }
};

const getTransactionsAdmin = async (req, res, next) => {
  try {
    const { dateFrom, dateTo, station, paymentMethod, status } = req.query;
    const { page, limit, skip } = parsePageParams(req.query);

    const filter = {};

    if (status) filter.status = String(status).trim();
    if (station) filter.station = station;
    if (paymentMethod) filter.paymentMethod = String(paymentMethod).trim();

    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;

      filter.completedAt = {};
      if (from && !Number.isNaN(from.getTime())) filter.completedAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) filter.completedAt.$lte = to;
      if (Object.keys(filter.completedAt).length === 0) delete filter.completedAt;
    }

    const [total, transactions] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .sort({ completedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("driver", "name phone email")
        .populate("station", "name code city location")
        .populate("attendant", "name phone email")
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      message: "Transactions",
      data: { page, limit, total, totalPages, transactions },
    });
  } catch (err) {
    return next(err);
  }
};

const getFraudAlerts = async (req, res, next) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last15m = new Date(now.getTime() - 15 * 60 * 1000);

    const [
      multiBookings,
      regeneratedQrs,
      highLiterTx,
      reversedTx,
    ] = await Promise.all([
      Booking.aggregate([
        { $match: { createdAt: { $gte: last24h } } },
        { $group: { _id: "$driver", count: { $sum: 1 } } },
        { $match: { count: { $gte: 3 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      QRCode.find({
        updatedAt: { $gte: last15m },
        used: false,
      })
        .select("booking driver updatedAt createdAt")
        .limit(50)
        .lean(),
      Transaction.find({
        status: "completed",
        completedAt: { $gte: last7d },
        liters: { $gte: 60 },
      })
        .select("liters fuelType station driver receiptNumber completedAt")
        .limit(50)
        .lean(),
      Transaction.find({
        status: "reversed",
        updatedAt: { $gte: last7d },
      })
        .select("liters fuelType station driver receiptNumber updatedAt")
        .limit(50)
        .lean(),
    ]);

    const alerts = [];

    for (const row of multiBookings) {
      alerts.push({
        type: "multiple_bookings",
        severity: row.count >= 6 ? "high" : "medium",
        message: `Driver has ${row.count} bookings in the last 24h`,
        refId: row._id,
      });
    }

    for (const qr of regeneratedQrs) {
      const createdAt = new Date(qr.createdAt || 0).getTime();
      const updatedAt = new Date(qr.updatedAt || 0).getTime();
      if (createdAt && updatedAt && updatedAt - createdAt >= 60 * 1000) {
        alerts.push({
          type: "qr_regenerated",
          severity: "low",
          message: "QR was regenerated recently",
          refId: qr.booking,
        });
      }
    }

    for (const tx of highLiterTx) {
      alerts.push({
        type: "high_liters",
        severity: tx.liters >= 90 ? "high" : "medium",
        message: `Unusually high liters dispensed: ${tx.liters}`,
        refId: tx._id,
      });
    }

    for (const tx of reversedTx) {
      alerts.push({
        type: "reversed_transaction",
        severity: "medium",
        message: "Transaction was reversed",
        refId: tx._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fraud alerts",
      data: { alerts: alerts.slice(0, 100) },
    });
  } catch (err) {
    return next(err);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    const analytics = await getAdminAnalytics();

    return res.status(200).json({
      success: true,
      message: "Analytics",
      data: analytics,
    });
  } catch (err) {
    return next(err);
  }
};

const setQuotaAdmin = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { monthlyLimit } = req.body;

    const driver = await User.findById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
        data: {},
      });
    }

    if (driver.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Target user is not a driver",
        data: {},
      });
    }

    const limit = Number(monthlyLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res.status(422).json({
        success: false,
        message: "monthlyLimit must be a number >= 0",
        data: {},
      });
    }

    const activeVehicle = await Vehicle.findOne({ driver: driverId, isActive: true });
    if (!activeVehicle) {
      return res.status(400).json({
        success: false,
        message: "Driver has no active vehicle",
        data: {},
      });
    }

    const { month, year } = getCurrentPeriod();
    const resetDate = getNextResetDate();

    let quota = await Quota.findOne({ driver: driverId });

    if (!quota) {
      quota = await Quota.create({
        driver: driverId,
        vehicleType: activeVehicle.type,
        monthlyLimit: limit,
        usedLiters: 0,
        remainingLiters: limit,
        resetDate,
        month,
        year,
        isManualOverride: true,
      });

      return res.status(201).json({
        success: true,
        message: "Quota created",
        data: { quota },
      });
    }

    quota.monthlyLimit = limit;
    quota.vehicleType = activeVehicle.type;
    quota.isManualOverride = true;

    const currentPeriod = getCurrentPeriod();
    if (quota.month !== currentPeriod.month || quota.year !== currentPeriod.year) {
      quota.month = currentPeriod.month;
      quota.year = currentPeriod.year;
      quota.resetDate = resetDate;
      quota.usedLiters = 0;
    }

    quota.usedLiters = clampNonNegative(quota.usedLiters);
    quota.remainingLiters = calculateRemaining(quota.monthlyLimit, quota.usedLiters);
    await quota.save();

    return res.status(200).json({
      success: true,
      message: "Quota updated",
      data: { quota },
    });
  } catch (err) {
    return next(err);
  }
};

const getSystemHealth = async (req, res, next) => {
  try {
    const state = mongoose.connection ? mongoose.connection.readyState : 0;

    const dbStatus =
      state === 1
        ? "connected"
        : state === 2
          ? "connecting"
          : state === 3
            ? "disconnecting"
            : "disconnected";

    return res.status(200).json({
      success: true,
      message: "System health",
      data: {
        dbStatus,
        serverTime: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getDashboardSummary,
  getRecentActivity,
  getUsers,
  updateUserStatus,
  getPendingDrivers,
  approveDriver,
  rejectDriver,
  getStationsAdmin,
  updateStationAdmin,
  getBookingsAdmin,
  cancelBookingAdmin,
  getTransactionsAdmin,
  getFraudAlerts,
  getAnalytics,
  setQuotaAdmin,
  getSystemHealth,
};
