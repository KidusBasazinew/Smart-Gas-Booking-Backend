const Quota = require("../models/Quota");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const {
  getCurrentPeriod,
  getNextResetDate,
  getDefaultMonthlyLimit,
  calculateRemaining,
  clampNonNegative,
} = require("../services/quotaService");

const refreshSingleQuota = async (driverId) => {
  const quota = await Quota.findOne({ driver: driverId });
  if (!quota) return null;

  quota.usedLiters = clampNonNegative(quota.usedLiters);
  quota.monthlyLimit = clampNonNegative(quota.monthlyLimit);
  quota.remainingLiters = calculateRemaining(
    quota.monthlyLimit,
    quota.usedLiters,
  );

  await quota.save();
  return quota;
};

const initializeMyQuota = async (req, res, next) => {
  try {
    const driverId = req.user._id;

    const activeVehicle = await Vehicle.findOne({
      driver: driverId,
      isActive: true,
    });
    if (!activeVehicle) {
      return res.status(400).json({
        success: false,
        message:
          "Active vehicle not found. Add and set an active vehicle first.",
      });
    }

    const { month, year } = getCurrentPeriod();
    const resetDate = getNextResetDate();

    let quota = await Quota.findOne({ driver: driverId });

    if (!quota) {
      const monthlyLimit = getDefaultMonthlyLimit(activeVehicle.type);
      quota = await Quota.create({
        driver: driverId,
        vehicleType: activeVehicle.type,
        monthlyLimit,
        usedLiters: 0,
        remainingLiters: monthlyLimit,
        resetDate,
        month,
        year,
        isManualOverride: false,
      });

      return res.status(201).json({
        success: true,
        message: "Quota initialized",
        data: { quota },
      });
    }

    const isNewMonth = quota.month !== month || quota.year !== year;

    if (isNewMonth) {
      quota.month = month;
      quota.year = year;
      quota.resetDate = resetDate;
      quota.usedLiters = 0;
      quota.vehicleType = activeVehicle.type;

      if (!quota.isManualOverride) {
        quota.monthlyLimit = getDefaultMonthlyLimit(activeVehicle.type);
      }
    } else {
      quota.vehicleType = activeVehicle.type;

      if (
        !quota.isManualOverride &&
        (!quota.monthlyLimit || quota.monthlyLimit < 0)
      ) {
        quota.monthlyLimit = getDefaultMonthlyLimit(activeVehicle.type);
      }
    }

    quota.remainingLiters = calculateRemaining(
      quota.monthlyLimit,
      quota.usedLiters,
    );
    await quota.save();

    return res.status(200).json({
      success: true,
      message: "Quota ready",
      data: { quota },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyQuota = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const quota = await Quota.findOne({ driver: driverId });

    return res.status(200).json({
      success: true,
      data: { quota },
    });
  } catch (err) {
    return next(err);
  }
};

const adminGetAllQuotas = async (req, res, next) => {
  try {
    const quotas = await Quota.find({})
      .populate("driver", "name phone email role isApproved isBlocked")
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      success: true,
      data: { quotas },
    });
  } catch (err) {
    return next(err);
  }
};

const adminSetQuota = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { monthlyLimit, notes } = req.body;

    const driver = await User.findById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    if (driver.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Target user is not a driver",
      });
    }

    const limit = Number(monthlyLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res.status(422).json({
        success: false,
        message: "monthlyLimit must be a number >= 0",
      });
    }

    const activeVehicle = await Vehicle.findOne({
      driver: driverId,
      isActive: true,
    });
    if (!activeVehicle) {
      return res.status(400).json({
        success: false,
        message: "Driver has no active vehicle",
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
        notes: notes ? String(notes).trim() : "",
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
    quota.notes =
      notes !== undefined ? String(notes || "").trim() : quota.notes;

    const currentPeriod = getCurrentPeriod();
    if (
      quota.month !== currentPeriod.month ||
      quota.year !== currentPeriod.year
    ) {
      quota.month = currentPeriod.month;
      quota.year = currentPeriod.year;
      quota.resetDate = resetDate;
      quota.usedLiters = 0;
    }

    quota.remainingLiters = calculateRemaining(
      quota.monthlyLimit,
      quota.usedLiters,
    );
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

const adminAdjustUsedLiters = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { deltaLiters, usedLiters, notes } = req.body;

    const quota = await Quota.findOne({ driver: driverId });
    if (!quota) {
      return res.status(404).json({
        success: false,
        message: "Quota not found",
      });
    }

    if (usedLiters !== undefined) {
      const absolute = Number(usedLiters);
      if (!Number.isFinite(absolute) || absolute < 0) {
        return res.status(422).json({
          success: false,
          message: "usedLiters must be a number >= 0",
        });
      }
      quota.usedLiters = absolute;
    } else {
      const delta = Number(deltaLiters);
      if (!Number.isFinite(delta)) {
        return res.status(422).json({
          success: false,
          message: "deltaLiters must be a valid number",
        });
      }
      quota.usedLiters = clampNonNegative(quota.usedLiters + delta);
    }

    quota.remainingLiters = calculateRemaining(
      quota.monthlyLimit,
      quota.usedLiters,
    );
    quota.notes =
      notes !== undefined ? String(notes || "").trim() : quota.notes;

    await quota.save();

    return res.status(200).json({
      success: true,
      message: "Quota usage adjusted",
      data: { quota },
    });
  } catch (err) {
    return next(err);
  }
};

const resetMonthlyQuotaForAll = async (req, res, next) => {
  try {
    const drivers = await User.find({
      role: "driver",
      isBlocked: { $ne: true },
    }).select("_id");
    const { month, year } = getCurrentPeriod();
    const resetDate = getNextResetDate();

    let resetCount = 0;

    for (const d of drivers) {
      const driverId = d._id;
      const activeVehicle = await Vehicle.findOne({
        driver: driverId,
        isActive: true,
      });
      if (!activeVehicle) continue;

      let quota = await Quota.findOne({ driver: driverId });

      if (!quota) {
        const limit = getDefaultMonthlyLimit(activeVehicle.type);
        quota = await Quota.create({
          driver: driverId,
          vehicleType: activeVehicle.type,
          monthlyLimit: limit,
          usedLiters: 0,
          remainingLiters: limit,
          resetDate,
          month,
          year,
          isManualOverride: false,
        });
        resetCount += 1;
        continue;
      }

      quota.vehicleType = activeVehicle.type;
      quota.month = month;
      quota.year = year;
      quota.resetDate = resetDate;
      quota.usedLiters = 0;

      if (!quota.isManualOverride) {
        quota.monthlyLimit = getDefaultMonthlyLimit(activeVehicle.type);
      }

      quota.remainingLiters = calculateRemaining(
        quota.monthlyLimit,
        quota.usedLiters,
      );
      await quota.save();
      resetCount += 1;
    }

    return res.status(200).json({
      success: true,
      message: "Monthly quotas reset",
      data: { resetCount },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  initializeMyQuota,
  getMyQuota,
  adminGetAllQuotas,
  adminSetQuota,
  adminAdjustUsedLiters,
  resetMonthlyQuotaForAll,
  refreshSingleQuota,
};
