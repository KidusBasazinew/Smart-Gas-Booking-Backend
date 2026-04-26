const crypto = require("crypto");
const qrcode = require("qrcode");

const timeSlotUtils = require("./timeSlot");

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

const isSameLocalDay = (a, b) => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

const generateSecureToken = (bytes = 32) => {
  const size = Number(bytes);
  const safeSize =
    Number.isFinite(size) && size >= 16 && size <= 64 ? size : 32;
  return crypto.randomBytes(safeSize).toString("hex");
};

const generateQRCodeImage = async (text) => {
  const value = String(text || "").trim();
  if (!value) return "";

  return qrcode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });
};

const parseTimeSlot = (slot) => {
  return timeSlotUtils.parseTimeSlot(slot);
};

const isWithinAllowedWindow = (bookingDate, timeSlot, options = {}) => {
  const earlyMinutesRaw = options.earlyMinutes;
  const earlyMinutes = Number.isFinite(Number(earlyMinutesRaw))
    ? Math.max(0, Number(earlyMinutesRaw))
    : 15;

  const now = options.now instanceof Date ? options.now : new Date();

  const dayStart = normalizeDayStart(bookingDate);
  if (!dayStart) {
    return { ok: false, message: "Invalid bookingDate" };
  }

  const todayStart = normalizeDayStart(now);
  if (!todayStart) {
    return { ok: false, message: "Invalid current time" };
  }

  if (!isSameLocalDay(dayStart, todayStart)) {
    return { ok: false, message: "Booking date must be today" };
  }

  const slotInfo = timeSlotUtils.getSlotStartEnd(dayStart, timeSlot);
  if (!slotInfo) {
    return { ok: false, message: "Invalid timeSlot" };
  }

  const windowStart = new Date(
    slotInfo.start.getTime() - earlyMinutes * 60 * 1000,
  );
  const windowEnd = slotInfo.end;

  if (now < windowStart) {
    return { ok: false, message: "Too early for QR generation" };
  }

  if (now > windowEnd) {
    return { ok: false, message: "Booking slot has ended" };
  }

  return {
    ok: true,
    message: "OK",
    slotStart: slotInfo.start,
    slotEnd: slotInfo.end,
    windowStart,
  };
};

module.exports = {
  generateSecureToken,
  generateQRCodeImage,
  parseTimeSlot,
  isWithinAllowedWindow,
};
