const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const Station = require("../models/Station");
const Quota = require("../models/Quota");
const Notification = require("../models/Notification");
const User = require("../models/User");

const { getMonthlyQuotaUsage } = require("../services/analyticsService");
const { scanFraudAlerts } = require("../services/fraudService");
const { notifyUser } = require("../services/notificationService");

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

const normalizeMonthRange = ({ month, year } = {}) => {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  if (!Number.isFinite(y) || y < 1970 || y > 9999) return null;
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  return { start, end, month: m, year: y };
};

const parsePageParams = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getDailyReport = async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || "").trim();
    const date = dateStr ? new Date(dateStr) : new Date();
    const start = normalizeDayStart(date);
    const end = normalizeDayEnd(date);
    if (!start || !end) {
      return res.status(422).json({
        success: false,
        message: "Invalid date. Use YYYY-MM-DD",
        data: {},
      });
    }

    const [
      bookingTotals,
      txTotals,
      litersAgg,
      revenueAgg,
      topStationAgg,
      fuelBreakdownAgg,
    ] = await Promise.all([
      Booking.aggregate([
        { $match: { bookingDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            completedBookings: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            cancelledBookings: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
        { $project: { _id: 0, totalBookings: 1, completedBookings: 1, cancelledBookings: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: "completed", completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, totalTransactions: { $sum: 1 } } },
        { $project: { _id: 0, totalTransactions: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: "completed", completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, litersDispensed: { $sum: "$liters" } } },
        { $project: { _id: 0, litersDispensed: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: "completed", completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, revenueEstimate: { $sum: "$totalAmount" } } },
        { $project: { _id: 0, revenueEstimate: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: "completed", completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: "$station", liters: { $sum: "$liters" }, count: { $sum: 1 } } },
        { $sort: { liters: -1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: "stations",
            localField: "_id",
            foreignField: "_id",
            as: "station",
          },
        },
        { $unwind: { path: "$station", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            stationId: "$_id",
            stationName: "$station.name",
            stationCode: "$station.code",
            liters: 1,
            count: 1,
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { status: "completed", completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: "$fuelType", liters: { $sum: "$liters" }, count: { $sum: 1 } } },
        { $sort: { liters: -1 } },
        { $project: { _id: 0, fuelType: "$_id", liters: 1, count: 1 } },
      ]),
    ]);

    const bt = bookingTotals[0] || {
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
    };
    const tt = txTotals[0] || { totalTransactions: 0 };
    const liters = litersAgg[0] || { litersDispensed: 0 };
    const revenue = revenueAgg[0] || { revenueEstimate: 0 };
    const topStation = topStationAgg[0] || null;
    const fuelBreakdown = fuelBreakdownAgg || [];

    return res.status(200).json({
      success: true,
      message: "Daily report",
      data: {
        date: start.toISOString().slice(0, 10),
        totalBookings: bt.totalBookings,
        completedBookings: bt.completedBookings,
        cancelledBookings: bt.cancelledBookings,
        totalTransactions: tt.totalTransactions,
        litersDispensed: Number(liters.litersDispensed || 0),
        revenueEstimate: Number(revenue.revenueEstimate || 0),
        topStation,
        fuelBreakdown,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getMonthlyReport = async (req, res, next) => {
  try {
    const range = normalizeMonthRange({
      month: req.query.month,
      year: req.query.year,
    });
    if (!range) {
      return res.status(422).json({
        success: false,
        message: "Invalid month/year",
        data: {},
      });
    }

    const { start, end, month, year } = range;

    const dateToString = {
      $dateToString: { format: "%Y-%m-%d", date: "$date" },
    };

    const [totalsAgg, bookingsTrend, txTrend, stationRankings, quotaUsage] =
      await Promise.all([
        Promise.all([
          Booking.aggregate([
            { $match: { bookingDate: { $gte: start, $lt: end } } },
            {
              $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                completedBookings: {
                  $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
                },
                cancelledBookings: {
                  $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
                },
              },
            },
            { $project: { _id: 0, totalBookings: 1, completedBookings: 1, cancelledBookings: 1 } },
          ]),
          Transaction.aggregate([
            { $match: { status: "completed", completedAt: { $gte: start, $lt: end } } },
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                litersDispensed: { $sum: "$liters" },
                revenueEstimate: { $sum: "$totalAmount" },
              },
            },
            {
              $project: {
                _id: 0,
                totalTransactions: 1,
                litersDispensed: 1,
                revenueEstimate: 1,
              },
            },
          ]),
        ]),
        Booking.aggregate([
          { $match: { bookingDate: { $gte: start, $lt: end } } },
          { $project: { date: "$bookingDate" } },
          { $group: { _id: dateToString, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: "$_id", count: 1 } },
        ]),
        Transaction.aggregate([
          { $match: { status: "completed", completedAt: { $gte: start, $lt: end } } },
          { $project: { date: "$completedAt", liters: "$liters" } },
          { $group: { _id: dateToString, count: { $sum: 1 }, liters: { $sum: "$liters" } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: "$_id", count: 1, liters: 1 } },
        ]),
        Transaction.aggregate([
          { $match: { status: "completed", completedAt: { $gte: start, $lt: end } } },
          { $group: { _id: "$station", liters: { $sum: "$liters" }, revenue: { $sum: "$totalAmount" }, transactions: { $sum: 1 } } },
          { $sort: { liters: -1 } },
          { $limit: 20 },
          {
            $lookup: {
              from: "stations",
              localField: "_id",
              foreignField: "_id",
              as: "station",
            },
          },
          { $unwind: { path: "$station", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              stationId: "$_id",
              stationName: "$station.name",
              stationCode: "$station.code",
              liters: 1,
              revenue: 1,
              transactions: 1,
            },
          },
        ]),
        getMonthlyQuotaUsage({ month, year }),
      ]);

    const bookingTotals = totalsAgg[0][0] || {
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
    };
    const txTotals = totalsAgg[1][0] || {
      totalTransactions: 0,
      litersDispensed: 0,
      revenueEstimate: 0,
    };

    return res.status(200).json({
      success: true,
      message: "Monthly report",
      data: {
        month,
        year,
        totals: {
          ...bookingTotals,
          ...txTotals,
        },
        bookingsTrend,
        transactionTrend: txTrend,
        stationRankings,
        quotaUsageSummary: quotaUsage,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getStationReport = async (req, res, next) => {
  try {
    const { stationId } = req.params;
    if (!mongoose.isValidObjectId(stationId)) {
      return res.status(400).json({ success: false, message: "Invalid stationId", data: {} });
    }

    const station = await Station.findById(stationId)
      .select("name code city location fuelTypes fuelStock status isDeleted")
      .lean();

    if (!station || station.isDeleted) {
      return res.status(404).json({ success: false, message: "Station not found", data: {} });
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

    const dateToString = { $dateToString: { format: "%Y-%m-%d", date: "$date" } };

    const [
      dailySales,
      litersByFuelType,
      attendantsPerformance,
      bookingLoad,
    ] = await Promise.all([
      Transaction.aggregate([
        { $match: { station: new mongoose.Types.ObjectId(stationId), status: "completed", completedAt: { $gte: start, $lt: end } } },
        { $project: { date: "$completedAt", liters: "$liters", revenue: "$totalAmount" } },
        { $group: { _id: dateToString, liters: { $sum: "$liters" }, revenue: { $sum: "$revenue" }, transactions: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", liters: 1, revenue: 1, transactions: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { station: new mongoose.Types.ObjectId(stationId), status: "completed", completedAt: { $gte: start, $lt: end } } },
        { $group: { _id: "$fuelType", liters: { $sum: "$liters" }, transactions: { $sum: 1 } } },
        { $sort: { liters: -1 } },
        { $project: { _id: 0, fuelType: "$_id", liters: 1, transactions: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { station: new mongoose.Types.ObjectId(stationId), status: "completed", completedAt: { $gte: start, $lt: end } } },
        { $group: { _id: "$attendant", liters: { $sum: "$liters" }, transactions: { $sum: 1 } } },
        { $sort: { liters: -1 } },
        { $limit: 20 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "attendant",
          },
        },
        { $unwind: { path: "$attendant", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, attendantId: "$_id", attendantName: "$attendant.name", attendantPhone: "$attendant.phone", liters: 1, transactions: 1 } },
      ]),
      Booking.aggregate([
        { $match: { station: new mongoose.Types.ObjectId(stationId), bookingDate: { $gte: start, $lt: end } } },
        { $project: { date: "$bookingDate", status: "$status" } },
        { $group: { _id: { date: dateToString, status: "$status" }, count: { $sum: 1 } } },
        { $sort: { "_id.date": 1 } },
        { $project: { _id: 0, date: "$_id.date", status: "$_id.status", count: 1 } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      message: "Station report",
      data: {
        station: {
          id: station._id,
          name: station.name,
          code: station.code,
          city: station.city,
          location: station.location,
          status: station.status,
        },
        dailySales,
        litersByFuelType,
        attendantsPerformance,
        bookingLoad,
        stockTrends: {
          currentStock: station.fuelStock || {},
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getDriverReport = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    if (!mongoose.isValidObjectId(driverId)) {
      return res.status(400).json({ success: false, message: "Invalid driverId", data: {} });
    }

    const { page, limit, skip } = parsePageParams(req.query);

    const [driver, quota, totalBookings, bookings, totalTx, transactions, suspiciousFlags] =
      await Promise.all([
        User.findById(driverId).select("name phone email role isApproved isBlocked").lean(),
        Quota.findOne({ driver: driverId })
          .select("monthlyLimit usedLiters remainingLiters month year resetDate vehicleType")
          .lean(),
        Booking.countDocuments({ driver: driverId }),
        Booking.find({ driver: driverId })
          .sort({ bookingDate: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("station", "name code city location")
          .populate("vehicle", "plateNumber type")
          .lean(),
        Transaction.countDocuments({ driver: driverId }),
        Transaction.find({ driver: driverId })
          .sort({ completedAt: -1, createdAt: -1 })
          .limit(100)
          .populate("station", "name code city location")
          .populate("attendant", "name phone email")
          .lean(),
        scanFraudAlerts({ driverId }),
      ]);

    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found", data: {} });
    }

    return res.status(200).json({
      success: true,
      message: "Driver report",
      data: {
        driver,
        bookingHistory: {
          page,
          limit,
          total: totalBookings,
          totalPages: Math.ceil(totalBookings / limit) || 1,
          bookings,
        },
        quotaUsage: quota || null,
        transactionHistory: {
          total: totalTx,
          transactions,
        },
        suspiciousFlags: suspiciousFlags || [],
      },
    });
  } catch (err) {
    return next(err);
  }
};

const exportReport = async (req, res, next) => {
  try {
    const type = String(req.query.type || "").trim().toLowerCase();
    if (!["daily", "monthly", "transactions", "users"].includes(type)) {
      return res.status(422).json({
        success: false,
        message: "type must be daily|monthly|transactions|users",
        data: {},
      });
    }

    if (type === "daily") {
      const date = String(req.query.date || "").trim() || new Date().toISOString().slice(0, 10);
      const fakeReq = { query: { date } };
      // Reuse logic by calling daily aggregates inline
      const start = normalizeDayStart(date);
      const end = normalizeDayEnd(date);
      if (!start || !end) {
        return res.status(422).json({ success: false, message: "Invalid date", data: {} });
      }

      const [txRows, bookingRows] = await Promise.all([
        Transaction.find({ status: "completed", completedAt: { $gte: start, $lte: end } })
          .populate("station", "name code city")
          .populate("driver", "name phone email")
          .populate("attendant", "name phone email")
          .lean(),
        Booking.find({ bookingDate: { $gte: start, $lte: end } })
          .populate("station", "name code city")
          .populate("driver", "name phone email")
          .populate("vehicle", "plateNumber type")
          .lean(),
      ]);

      return res.status(200).json({
        success: true,
        message: "Export daily report",
        data: {
          type: "daily",
          date: start.toISOString().slice(0, 10),
          sheets: {
            bookings: (bookingRows || []).map((b) => ({
              id: b._id,
              bookingDate: b.bookingDate,
              timeSlot: b.timeSlot,
              status: b.status,
              fuelType: b.fuelType,
              requestedLiters: b.requestedLiters,
              approvedLiters: b.approvedLiters,
              driverName: b.driver?.name,
              driverPhone: b.driver?.phone,
              stationName: b.station?.name,
              stationCode: b.station?.code,
              vehiclePlate: b.vehicle?.plateNumber,
            })),
            transactions: (txRows || []).map((t) => ({
              id: t._id,
              completedAt: t.completedAt,
              status: t.status,
              receiptNumber: t.receiptNumber,
              liters: t.liters,
              fuelType: t.fuelType,
              pricePerLiter: t.pricePerLiter,
              totalAmount: t.totalAmount,
              paymentMethod: t.paymentMethod,
              stationName: t.station?.name,
              stationCode: t.station?.code,
              driverName: t.driver?.name,
              driverPhone: t.driver?.phone,
              attendantName: t.attendant?.name,
              attendantPhone: t.attendant?.phone,
            })),
          },
        },
      });
    }

    if (type === "monthly") {
      const month = req.query.month;
      const year = req.query.year;
      const range = normalizeMonthRange({ month, year });
      if (!range) {
        return res.status(422).json({ success: false, message: "Invalid month/year", data: {} });
      }

      const { start, end } = range;
      const [txRows, bookingRows] = await Promise.all([
        Transaction.find({ status: "completed", completedAt: { $gte: start, $lt: end } })
          .populate("station", "name code city")
          .populate("driver", "name phone email")
          .populate("attendant", "name phone email")
          .lean(),
        Booking.find({ bookingDate: { $gte: start, $lt: end } })
          .populate("station", "name code city")
          .populate("driver", "name phone email")
          .populate("vehicle", "plateNumber type")
          .lean(),
      ]);

      return res.status(200).json({
        success: true,
        message: "Export monthly report",
        data: {
          type: "monthly",
          month: range.month,
          year: range.year,
          sheets: {
            bookings: (bookingRows || []).map((b) => ({
              id: b._id,
              bookingDate: b.bookingDate,
              timeSlot: b.timeSlot,
              status: b.status,
              fuelType: b.fuelType,
              requestedLiters: b.requestedLiters,
              approvedLiters: b.approvedLiters,
              driverName: b.driver?.name,
              driverPhone: b.driver?.phone,
              stationName: b.station?.name,
              stationCode: b.station?.code,
              vehiclePlate: b.vehicle?.plateNumber,
            })),
            transactions: (txRows || []).map((t) => ({
              id: t._id,
              completedAt: t.completedAt,
              status: t.status,
              receiptNumber: t.receiptNumber,
              liters: t.liters,
              fuelType: t.fuelType,
              pricePerLiter: t.pricePerLiter,
              totalAmount: t.totalAmount,
              paymentMethod: t.paymentMethod,
              stationName: t.station?.name,
              stationCode: t.station?.code,
              driverName: t.driver?.name,
              driverPhone: t.driver?.phone,
              attendantName: t.attendant?.name,
              attendantPhone: t.attendant?.phone,
            })),
          },
        },
      });
    }

    if (type === "transactions") {
      const { from, to, status } = req.query;
      const filter = {};
      if (status) filter.status = String(status).trim();
      if (from || to) {
        const fromDate = from ? new Date(from) : null;
        const toDate = to ? new Date(to) : null;
        filter.completedAt = {};
        if (fromDate && !Number.isNaN(fromDate.getTime())) filter.completedAt.$gte = fromDate;
        if (toDate && !Number.isNaN(toDate.getTime())) filter.completedAt.$lte = toDate;
        if (Object.keys(filter.completedAt).length === 0) delete filter.completedAt;
      }

      const rows = await Transaction.find(filter)
        .sort({ completedAt: -1, createdAt: -1 })
        .limit(5000)
        .populate("station", "name code city")
        .populate("driver", "name phone email")
        .populate("attendant", "name phone email")
        .lean();

      return res.status(200).json({
        success: true,
        message: "Export transactions",
        data: {
          type: "transactions",
          rows: (rows || []).map((t) => ({
            id: t._id,
            completedAt: t.completedAt,
            status: t.status,
            receiptNumber: t.receiptNumber,
            liters: t.liters,
            fuelType: t.fuelType,
            pricePerLiter: t.pricePerLiter,
            totalAmount: t.totalAmount,
            paymentMethod: t.paymentMethod,
            stationName: t.station?.name,
            stationCode: t.station?.code,
            driverName: t.driver?.name,
            driverPhone: t.driver?.phone,
            attendantName: t.attendant?.name,
            attendantPhone: t.attendant?.phone,
          })),
        },
      });
    }

    const { role, approved, blocked } = req.query;
    const filter = {};
    if (role) filter.role = String(role).trim();
    if (approved !== undefined) {
      const v = String(approved).toLowerCase();
      if (v === "true" || v === "false") filter.isApproved = v === "true";
    }
    if (blocked !== undefined) {
      const v = String(blocked).toLowerCase();
      if (v === "true" || v === "false") filter.isBlocked = v === "true";
    }

    const users = await User.find(filter)
      .select("name phone email role isApproved isBlocked createdAt")
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Export users",
      data: {
        type: "users",
        rows: (users || []).map((u) => ({
          id: u._id,
          name: u.name,
          phone: u.phone,
          email: u.email,
          role: u.role,
          isApproved: u.isApproved,
          isBlocked: u.isBlocked,
          createdAt: u.createdAt,
        })),
      },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = parsePageParams(req.query);
    const isRead = req.query.isRead;

    const filter = { user: userId };
    if (isRead !== undefined) {
      const v = String(isRead).toLowerCase();
      if (v === "true" || v === "false") filter.isRead = v === "true";
    }

    const [total, notifications] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      message: "My notifications",
      data: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        notifications,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notif = await Notification.findById(id);
    if (!notif) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
        data: {},
      });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = String(notif.user) === String(userId);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
        data: {},
      });
    }

    notif.isRead = true;
    notif.readAt = new Date();
    await notif.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: { notification: notif.toJSON ? notif.toJSON() : notif },
    });
  } catch (err) {
    return next(err);
  }
};

const adminBroadcastNotification = async (req, res, next) => {
  try {
    const { role, title, message, type } = req.body || {};
    const normalizedRole = role ? String(role).trim() : null;

    if (!title || !message) {
      return res.status(422).json({
        success: false,
        message: "title and message are required",
        data: {},
      });
    }

    const userFilter = {};
    if (normalizedRole) userFilter.role = normalizedRole;

    const users = await User.find(userFilter).select("_id").lean();
    const ids = users.map((u) => u._id);

    if (ids.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Broadcast sent (no recipients)",
        data: { recipients: 0 },
      });
    }

    // Bulk insert for speed; still uses the Notification collection.
    const docs = ids.map((uid) => ({
      user: uid,
      title: String(title).trim(),
      message: String(message).trim(),
      type: type ? String(type).trim() : "info",
      channel: "inapp",
      isRead: false,
      readAt: null,
      meta: { broadcast: true, role: normalizedRole || null },
    }));

    await Notification.insertMany(docs, { ordered: false });

    return res.status(201).json({
      success: true,
      message: "Broadcast notification sent",
      data: { recipients: ids.length },
    });
  } catch (err) {
    return next(err);
  }
};

const scanFraud = async (req, res, next) => {
  try {
    const alerts = await scanFraudAlerts({});
    return res.status(200).json({
      success: true,
      message: "Fraud scan",
      data: { alerts },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getDailyReport,
  getMonthlyReport,
  getStationReport,
  getDriverReport,
  exportReport,
  getMyNotifications,
  markNotificationRead,
  adminBroadcastNotification,
  scanFraud,
};

