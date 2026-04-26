const Booking = require("../models/Booking");
const QRCode = require("../models/QRCode");
const Transaction = require("../models/Transaction");
const Quota = require("../models/Quota");
const Vehicle = require("../models/Vehicle");
const AuditLog = require("../models/AuditLog");

const nowMinus = (ms) => new Date(Date.now() - ms);

const startOfDay = (d) => {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
};

const scanFraudAlerts = async ({ driverId = null, stationId = null } = {}) => {
  const createdAt = new Date();

  const last24h = nowMinus(24 * 60 * 60 * 1000);
  const last7d = nowMinus(7 * 24 * 60 * 60 * 1000);
  const last30d = nowMinus(30 * 24 * 60 * 60 * 1000);
  const last15m = nowMinus(15 * 60 * 1000);

  const bookingFilter = driverId ? { driver: driverId } : {};
  const stationFilter = stationId ? { station: stationId } : {};

  const [
    activeMultipleBookings,
    qrRegenCounts,
    quotaOverAttempts,
    reversalHotspots,
    suspiciousMidnightAdmin,
    tooManyCancelled,
    duplicatePlatePatterns,
  ] = await Promise.all([
    Booking.aggregate([
      { $match: { ...bookingFilter, status: { $in: ["pending", "confirmed"] } } },
      { $group: { _id: "$driver", activeCount: { $sum: 1 } } },
      { $match: { activeCount: { $gte: 2 } } },
      { $sort: { activeCount: -1 } },
      { $limit: 50 },
    ]),
    QRCode.aggregate([
      { $match: { ...bookingFilter, used: false, updatedAt: { $gte: last15m } } },
      { $group: { _id: "$booking", regenCount: { $sum: 1 } } },
      { $match: { regenCount: { $gte: 3 } } },
      { $sort: { regenCount: -1 } },
      { $limit: 50 },
    ]),
    Quota.find(driverId ? { driver: driverId } : {})
      .select("driver remainingLiters usedLiters monthlyLimit")
      .lean(),
    Transaction.aggregate([
      {
        $match: {
          status: "reversed",
          updatedAt: { $gte: last30d },
          ...(stationId ? { station: stationId } : {}),
        },
      },
      { $group: { _id: "$station", reversals: { $sum: 1 } } },
      { $match: { reversals: { $gte: 3 } } },
      { $sort: { reversals: -1 } },
      { $limit: 20 },
    ]),
    AuditLog.aggregate([
      {
        $match: {
          role: "admin",
          createdAt: { $gte: last7d },
        },
      },
      {
        $addFields: {
          hour: { $hour: "$createdAt" },
        },
      },
      { $match: { hour: { $in: [0, 1, 2, 3, 4] } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    Booking.aggregate([
      { $match: { ...bookingFilter, createdAt: { $gte: last30d } } },
      { $group: { _id: "$driver", cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } }, total: { $sum: 1 } } },
      { $match: { total: { $gte: 5 } } },
      { $project: { rate: { $cond: [{ $gt: ["$total", 0] }, { $divide: ["$cancelled", "$total"] }, 0] }, cancelled: 1, total: 1 } },
      { $match: { $or: [{ cancelled: { $gte: 8 } }, { rate: { $gte: 0.6 } }] } },
      { $sort: { cancelled: -1 } },
      { $limit: 50 },
    ]),
    Vehicle.aggregate([
      { $match: { ...(driverId ? { driver: driverId } : {}), plateNumber: { $exists: true, $ne: "" } } },
      {
        $project: {
          driver: 1,
          plateNumber: 1,
          normalized: {
            $toUpper: {
              $replaceAll: { input: "$plateNumber", find: " ", replacement: "" },
            },
          },
        },
      },
      { $group: { _id: "$normalized", count: { $sum: 1 }, drivers: { $addToSet: "$driver" } } },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
  ]);

  const alerts = [];

  for (const row of activeMultipleBookings || []) {
    alerts.push({
      type: "multiple_active_bookings",
      severity: row.activeCount >= 3 ? "high" : "medium",
      message: `Driver has ${row.activeCount} active bookings`,
      refId: row._id,
      createdAt,
    });
  }

  for (const row of qrRegenCounts || []) {
    alerts.push({
      type: "repeated_qr_generation",
      severity: row.regenCount >= 5 ? "high" : "medium",
      message: `QR generated repeatedly for the same booking (${row.regenCount} times within ~15 minutes)`,
      refId: row._id,
      createdAt,
    });
  }

  for (const q of quotaOverAttempts || []) {
    const remaining = Number(q.remainingLiters);
    if (Number.isFinite(remaining) && remaining <= 0) {
      alerts.push({
        type: "liters_above_quota_attempt",
        severity: "medium",
        message: "Driver quota is exhausted; watch for over-quota attempts",
        refId: q.driver,
        createdAt,
      });
    }
  }

  for (const row of reversalHotspots || []) {
    alerts.push({
      type: "repeated_reversals_same_station",
      severity: row.reversals >= 6 ? "high" : "medium",
      message: `Station has ${row.reversals} reversed transactions in the last 30 days`,
      refId: row._id,
      createdAt,
    });
  }

  for (const row of suspiciousMidnightAdmin || []) {
    alerts.push({
      type: "suspicious_midnight_admin_actions",
      severity: row.count >= 8 ? "high" : "medium",
      message: `Admin performed ${row.count} actions between 00:00–04:59 in the last 7 days`,
      refId: row._id,
      createdAt,
    });
  }

  for (const row of tooManyCancelled || []) {
    alerts.push({
      type: "too_many_cancelled_bookings",
      severity: row.cancelled >= 12 ? "high" : "medium",
      message: `Driver cancelled ${row.cancelled}/${row.total} bookings in the last 30 days`,
      refId: row._id,
      createdAt,
    });
  }

  for (const row of duplicatePlatePatterns || []) {
    alerts.push({
      type: "duplicate_plate_patterns",
      severity: row.count >= 3 ? "high" : "medium",
      message: `Duplicate vehicle plate pattern detected (${row.count} vehicles share the same normalized plate)`,
      refId: row._id,
      createdAt,
    });
  }

  // Extra: high liters trend in last 7 days (station-scoped if provided)
  const highLitersRows = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        completedAt: { $gte: last7d },
        liters: { $gte: 60 },
        ...(driverId ? { driver: driverId } : {}),
        ...(stationId ? { station: stationId } : {}),
      },
    },
    { $sort: { liters: -1, completedAt: -1 } },
    { $limit: 30 },
    { $project: { liters: 1, driver: 1, station: 1, completedAt: 1 } },
  ]);

  for (const tx of highLitersRows || []) {
    alerts.push({
      type: "high_liters",
      severity: Number(tx.liters) >= 90 ? "high" : "medium",
      message: `Unusually high liters dispensed: ${tx.liters}`,
      refId: tx._id,
      createdAt,
    });
  }

  // Normalize ordering newest first (createdAt is same for most, so fallback to message)
  alerts.sort((a, b) => String(a.type).localeCompare(String(b.type)));

  return alerts.slice(0, 200);
};

const autoFlagTransactions = async () => {
  // Tagging is optional in your schema; return alerts for now.
  const start = startOfDay(new Date());
  const rows = await Transaction.find({
    status: "completed",
    completedAt: { $gte: start },
    liters: { $gte: 60 },
  })
    .select("_id liters driver station completedAt")
    .limit(200)
    .lean();

  return (rows || []).map((t) => ({
    type: "high_liters",
    severity: Number(t.liters) >= 90 ? "high" : "medium",
    message: `Unusually high liters dispensed: ${t.liters}`,
    refId: t._id,
    createdAt: new Date(),
  }));
};

module.exports = {
  scanFraudAlerts,
  autoFlagTransactions,
};

