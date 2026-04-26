const { DEFAULT_MONTHLY_QUOTAS } = require("../config/constants");

const clampNonNegative = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const getCurrentPeriod = (date = new Date()) => {
  return {
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  };
};

const getNextResetDate = (date = new Date()) => {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  return new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
};

const getDefaultMonthlyLimit = (vehicleType) => {
  const key = String(vehicleType || "").trim();
  const limit = DEFAULT_MONTHLY_QUOTAS[key];
  return Number.isFinite(limit) ? limit : 0;
};

const calculateRemaining = (monthlyLimit, usedLiters) => {
  const remaining =
    clampNonNegative(monthlyLimit) - clampNonNegative(usedLiters);
  return Math.max(0, remaining);
};

module.exports = {
  clampNonNegative,
  getCurrentPeriod,
  getNextResetDate,
  getDefaultMonthlyLimit,
  calculateRemaining,
};
