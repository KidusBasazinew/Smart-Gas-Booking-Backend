const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const Quota = require("../models/Quota");

const startOfDay = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

const addDays = (date, days) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  return d;
};

const getDateString = () => {
  return {
    $dateToString: {
      format: "%Y-%m-%d",
      date: "$date",
    },
  };
};

const normalizeGroupedCounts = ({ start, days, rows }) => {
  const map = new Map();
  for (const r of rows) {
    map.set(r._id, r);
  }

  const out = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(start, i);
    const key = day.toISOString().slice(0, 10);
    const row = map.get(key);
    out.push({
      date: key,
      count: row ? row.count : 0,
      liters: row && Number.isFinite(row.liters) ? row.liters : 0,
    });
  }
  return out;
};

const getBookingsByDay = async ({ days = 7 } = {}) => {
  const now = new Date();
  const today = startOfDay(now);
  const start = addDays(today, -(Number(days) - 1));

  const rows = await Booking.aggregate([
    {
      $match: {
        bookingDate: { $gte: start },
      },
    },
    {
      $project: {
        date: "$bookingDate",
      },
    },
    {
      $group: {
        _id: getDateString(),
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const normalized = normalizeGroupedCounts({ start, days, rows });
  return normalized.map((r) => ({ date: r.date, count: r.count }));
};

const getTransactionsByDay = async ({ days = 7 } = {}) => {
  const now = new Date();
  const today = startOfDay(now);
  const start = addDays(today, -(Number(days) - 1));

  const rows = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        completedAt: { $gte: start },
      },
    },
    {
      $project: {
        date: "$completedAt",
        liters: "$liters",
      },
    },
    {
      $group: {
        _id: getDateString(),
        count: { $sum: 1 },
        liters: { $sum: "$liters" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const normalized = normalizeGroupedCounts({ start, days, rows });
  return normalized.map((r) => ({
    date: r.date,
    count: r.count,
    liters: r.liters,
  }));
};

const getFuelByType = async ({ days = 30 } = {}) => {
  const now = new Date();
  const start = addDays(now, -Number(days));

  const rows = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        completedAt: { $gte: start },
      },
    },
    {
      $group: {
        _id: "$fuelType",
        liters: { $sum: "$liters" },
        count: { $sum: 1 },
      },
    },
    { $sort: { liters: -1 } },
  ]);

  return rows.map((r) => ({
    fuelType: r._id || "unknown",
    liters: r.liters,
    count: r.count,
  }));
};

const getTopStations = async ({ days = 30, limit = 5 } = {}) => {
  const now = new Date();
  const start = addDays(now, -Number(days));
  const topLimit = Math.max(1, Math.min(25, Number(limit) || 5));

  const rows = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        completedAt: { $gte: start },
      },
    },
    {
      $group: {
        _id: "$station",
        liters: { $sum: "$liters" },
        count: { $sum: 1 },
      },
    },
    { $sort: { liters: -1 } },
    { $limit: topLimit },
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
        liters: 1,
        count: 1,
        stationName: "$station.name",
        stationCode: "$station.code",
        city: "$station.city",
      },
    },
  ]);

  return rows;
};

const getVehicleTypeUsage = async ({ days = 30 } = {}) => {
  const now = new Date();
  const start = addDays(now, -Number(days));

  const rows = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: start },
      },
    },
    {
      $lookup: {
        from: "vehicles",
        localField: "vehicle",
        foreignField: "_id",
        as: "vehicle",
      },
    },
    { $unwind: { path: "$vehicle", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$vehicle.type",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  return rows.map((r) => ({ vehicleType: r._id || "unknown", count: r.count }));
};

const getMonthlyQuotaUsage = async ({ month, year } = {}) => {
  const now = new Date();
  const m = Number(month) || now.getMonth() + 1;
  const y = Number(year) || now.getFullYear();

  const totals = await Quota.aggregate([
    { $match: { month: m, year: y } },
    {
      $group: {
        _id: null,
        totalDrivers: { $sum: 1 },
        totalMonthlyLimit: { $sum: "$monthlyLimit" },
        totalUsedLiters: { $sum: "$usedLiters" },
        totalRemainingLiters: { $sum: "$remainingLiters" },
      },
    },
    {
      $project: {
        _id: 0,
        totalDrivers: 1,
        totalMonthlyLimit: 1,
        totalUsedLiters: 1,
        totalRemainingLiters: 1,
      },
    },
  ]);

  const byVehicleType = await Quota.aggregate([
    { $match: { month: m, year: y } },
    {
      $group: {
        _id: "$vehicleType",
        drivers: { $sum: 1 },
        monthlyLimit: { $sum: "$monthlyLimit" },
        usedLiters: { $sum: "$usedLiters" },
        remainingLiters: { $sum: "$remainingLiters" },
      },
    },
    { $sort: { drivers: -1 } },
    {
      $project: {
        _id: 0,
        vehicleType: "$_id",
        drivers: 1,
        monthlyLimit: 1,
        usedLiters: 1,
        remainingLiters: 1,
      },
    },
  ]);

  return {
    month: m,
    year: y,
    totals: totals[0] || {
      totalDrivers: 0,
      totalMonthlyLimit: 0,
      totalUsedLiters: 0,
      totalRemainingLiters: 0,
    },
    byVehicleType,
  };
};

const getAdminAnalytics = async () => {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    // Still allow aggregations; Mongoose will error if DB is down.
  }

  const [
    bookingsByDay,
    transactionsByDay,
    fuelByType,
    topStations,
    vehicleTypeUsage,
    monthlyQuotaUsage,
  ] = await Promise.all([
    getBookingsByDay({ days: 7 }),
    getTransactionsByDay({ days: 7 }),
    getFuelByType({ days: 30 }),
    getTopStations({ days: 30, limit: 5 }),
    getVehicleTypeUsage({ days: 30 }),
    getMonthlyQuotaUsage({}),
  ]);

  return {
    bookingsByDay,
    transactionsByDay,
    fuelByType,
    topStations,
    vehicleTypeUsage,
    monthlyQuotaUsage,
  };
};

module.exports = {
  getAdminAnalytics,
  getBookingsByDay,
  getTransactionsByDay,
  getFuelByType,
  getTopStations,
  getVehicleTypeUsage,
  getMonthlyQuotaUsage,
};
