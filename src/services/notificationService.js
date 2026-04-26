const Notification = require("../models/Notification");

const notifyUser = async (userId, title, message, type = "info", meta = {}) => {
  const doc = await Notification.create({
    user: userId,
    title: String(title || "").trim(),
    message: String(message || "").trim(),
    type,
    channel: "inapp",
    isRead: false,
    readAt: null,
    meta: meta !== undefined ? meta : {},
  });
  return doc;
};

const notifyBookingConfirmed = async ({ userId, bookingId, stationName } = {}) => {
  return notifyUser(
    userId,
    "Booking confirmed",
    stationName
      ? `Your booking is confirmed at ${stationName}.`
      : "Your booking is confirmed.",
    "success",
    { bookingId },
  );
};

const notifyBookingCancelled = async ({
  userId,
  bookingId,
  reason = "",
} = {}) => {
  const msg = reason
    ? `Your booking was cancelled. Reason: ${reason}`
    : "Your booking was cancelled.";
  return notifyUser(userId, "Booking cancelled", msg, "warning", { bookingId });
};

const notifyQuotaLow = async ({ userId, remainingLiters } = {}) => {
  const liters =
    remainingLiters === undefined || remainingLiters === null
      ? null
      : Number(remainingLiters);
  const msg =
    liters !== null && Number.isFinite(liters)
      ? `Your remaining quota is low (${liters} liters).`
      : "Your remaining quota is low.";
  return notifyUser(userId, "Quota low", msg, "warning", { remainingLiters });
};

const notifyTransactionCompleted = async ({
  userId,
  transactionId,
  liters,
  totalAmount,
} = {}) => {
  const litersNum = Number(liters);
  const amountNum = Number(totalAmount);
  const msgParts = [];
  if (Number.isFinite(litersNum)) msgParts.push(`${litersNum} liters`);
  if (Number.isFinite(amountNum)) msgParts.push(`ETB ${amountNum}`);
  const msg =
    msgParts.length > 0
      ? `Transaction completed: ${msgParts.join(" • ")}.`
      : "Transaction completed.";

  return notifyUser(userId, "Transaction completed", msg, "success", {
    transactionId,
  });
};

const notifyDriverApproved = async ({ userId } = {}) => {
  return notifyUser(
    userId,
    "Driver approved",
    "Your driver account has been approved.",
    "success",
    {},
  );
};

module.exports = {
  notifyUser,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyQuotaLow,
  notifyTransactionCompleted,
  notifyDriverApproved,
};

