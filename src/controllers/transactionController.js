const mongoose = require("mongoose");

const Transaction = require("../models/Transaction");
const QRCode = require("../models/QRCode");
const Booking = require("../models/Booking");
const Quota = require("../models/Quota");
const Station = require("../models/Station");

const {
  calculateRemaining,
  clampNonNegative,
} = require("../services/quotaService");
const { generateReceiptNumber } = require("../utils/receiptUtils");

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

const isMongoTransactionsUnsupported = (err) => {
  const msg = String((err && err.message) || "");
  return (
    msg.includes("Transaction numbers are only allowed") ||
    msg.includes("replica set") ||
    msg.includes("not supported")
  );
};

const runWithOptionalMongoTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      output = await work(session);
    });
    return output;
  } catch (err) {
    if (isMongoTransactionsUnsupported(err)) {
      return work(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
};

const getFuelStockPath = (fuelType) => {
  if (fuelType === "petrol") return "fuelStock.petrol";
  if (fuelType === "diesel") return "fuelStock.diesel";
  return null;
};

const tryCreateUniqueReceiptNumber = async (session) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const receiptNumber = generateReceiptNumber(new Date());
    // eslint-disable-next-line no-await-in-loop
    const exists = await Transaction.exists({ receiptNumber }).session(
      session || null,
    );
    if (!exists) return receiptNumber;
  }

  return generateReceiptNumber(new Date());
};

const dispenseFuel = async (req, res, next) => {
  try {
    const authUser = req.user;
    const { token, liters, paymentMethod, pumpNumber, pricePerLiter } =
      req.body;

    const normalizedToken = String(token || "").trim();
    const litersNum = Number(liters);
    const priceNum = pricePerLiter === undefined ? 0 : Number(pricePerLiter);

    if (!normalizedToken) {
      return res.status(422).json({
        success: false,
        message: "token is required",
        data: {},
      });
    }

    if (!Number.isFinite(litersNum) || litersNum <= 0) {
      return res.status(422).json({
        success: false,
        message: "liters must be a number > 0",
        data: {},
      });
    }

    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(422).json({
        success: false,
        message: "pricePerLiter must be a number >= 0",
        data: {},
      });
    }

    const now = new Date();

    const result = await runWithOptionalMongoTransaction(async (session) => {
      const sessionOrNull = session || null;

      const qr = await QRCode.findOne({ token: normalizedToken }).session(
        sessionOrNull,
      );
      if (!qr) {
        return {
          status: 404,
          body: { success: false, message: "QR token not found", data: {} },
        };
      }

      if (qr.used) {
        return {
          status: 400,
          body: { success: false, message: "QR already used", data: {} },
        };
      }

      if (!qr.validatedAt) {
        return {
          status: 400,
          body: { success: false, message: "QR not validated", data: {} },
        };
      }

      if (qr.expiresAt && qr.expiresAt.getTime() <= now.getTime()) {
        return {
          status: 400,
          body: { success: false, message: "QR expired", data: {} },
        };
      }

      const booking = await Booking.findById(qr.booking)
        .session(sessionOrNull)
        .populate("driver", "name phone email")
        .populate("vehicle", "plateNumber type model color")
        .populate("station", "name code city location status");

      if (!booking) {
        return {
          status: 404,
          body: { success: false, message: "Booking not found", data: {} },
        };
      }

      if (booking.status !== "confirmed") {
        return {
          status: 400,
          body: {
            success: false,
            message: "Booking is not confirmed",
            data: {},
          },
        };
      }

      const existingTx = await Transaction.findOne({
        booking: booking._id,
      }).session(sessionOrNull);

      if (existingTx) {
        return {
          status: 409,
          body: {
            success: false,
            message: "Booking already processed",
            data: {},
          },
        };
      }

      if (
        !Number.isFinite(booking.approvedLiters) ||
        litersNum > booking.approvedLiters
      ) {
        return {
          status: 400,
          body: {
            success: false,
            message: "liters cannot exceed booking approvedLiters",
            data: {},
          },
        };
      }

      const quota = await Quota.findOne({ driver: booking.driver._id }).session(
        sessionOrNull,
      );
      if (!quota) {
        return {
          status: 400,
          body: { success: false, message: "Driver quota not found", data: {} },
        };
      }

      const remaining = clampNonNegative(quota.remainingLiters);
      if (litersNum > remaining) {
        return {
          status: 400,
          body: {
            success: false,
            message: "liters cannot exceed remaining quota",
            data: {},
          },
        };
      }

      const station = await Station.findById(booking.station._id).session(
        sessionOrNull,
      );
      if (!station || station.isDeleted) {
        return {
          status: 404,
          body: { success: false, message: "Station not found", data: {} },
        };
      }

      const stockPath = getFuelStockPath(booking.fuelType);
      if (!stockPath) {
        return {
          status: 400,
          body: { success: false, message: "Invalid fuel type", data: {} },
        };
      }

      const currentStock = clampNonNegative(
        booking.fuelType === "petrol"
          ? station.fuelStock.petrol
          : station.fuelStock.diesel,
      );

      if (litersNum > currentStock) {
        return {
          status: 400,
          body: {
            success: false,
            message: "liters cannot exceed station fuel stock",
            data: {},
          },
        };
      }

      const receiptNumber = await tryCreateUniqueReceiptNumber(sessionOrNull);
      const totalAmount = Number((litersNum * priceNum).toFixed(2));

      const txDoc = {
        driver: booking.driver._id,
        station: booking.station._id,
        attendant: authUser._id,
        booking: booking._id,
        qrCode: qr._id,
        liters: litersNum,
        fuelType: booking.fuelType,
        pricePerLiter: priceNum,
        totalAmount,
        paymentMethod: paymentMethod ? String(paymentMethod).trim() : "cash",
        receiptNumber,
        pumpNumber: pumpNumber ? String(pumpNumber).trim() : "",
        status: "completed",
        completedAt: now,
      };

      const created = await Transaction.create(
        [txDoc],
        sessionOrNull ? { session: sessionOrNull } : undefined,
      );
      const transaction = created[0];

      const rollback = {
        quota: false,
        stock: false,
        booking: false,
        qr: false,
        transaction: true,
      };

      try {
        const quotaRes = await Quota.updateOne(
          { _id: quota._id, remainingLiters: { $gte: litersNum } },
          { $inc: { usedLiters: litersNum, remainingLiters: -litersNum } },
          { session: sessionOrNull || undefined },
        );
        if (!quotaRes || quotaRes.modifiedCount !== 1)
          throw new Error("Quota update failed");
        rollback.quota = true;

        const stockRes = await Station.updateOne(
          { _id: station._id, [stockPath]: { $gte: litersNum } },
          { $inc: { [stockPath]: -litersNum } },
          { session: sessionOrNull || undefined },
        );
        if (!stockRes || stockRes.modifiedCount !== 1)
          throw new Error("Station stock update failed");
        rollback.stock = true;

        const bookingRes = await Booking.updateOne(
          { _id: booking._id, status: "confirmed" },
          { $set: { status: "completed", completedAt: now } },
          { session: sessionOrNull || undefined },
        );
        if (!bookingRes || bookingRes.modifiedCount !== 1)
          throw new Error("Booking update failed");
        rollback.booking = true;

        const qrRes = await QRCode.updateOne(
          { _id: qr._id, used: false, expiresAt: { $gt: now } },
          {
            $set: {
              used: true,
              usedAt: now,
              attendant: authUser._id,
              station: booking.station._id,
            },
          },
          { session: sessionOrNull || undefined },
        );
        if (!qrRes || qrRes.modifiedCount !== 1)
          throw new Error("QR update failed");
        rollback.qr = true;
      } catch (err) {
        if (!sessionOrNull) {
          if (rollback.qr) {
            await QRCode.updateOne(
              { _id: qr._id },
              { $set: { used: false, usedAt: null, attendant: null } },
            );
          }
          if (rollback.booking) {
            await Booking.updateOne(
              { _id: booking._id },
              { $set: { status: "confirmed", completedAt: null } },
            );
          }
          if (rollback.stock) {
            await Station.updateOne(
              { _id: station._id },
              { $inc: { [stockPath]: litersNum } },
            );
          }
          if (rollback.quota) {
            await Quota.updateOne(
              { _id: quota._id },
              { $inc: { usedLiters: -litersNum, remainingLiters: litersNum } },
            );
          }
          if (rollback.transaction) {
            await Transaction.deleteOne({ _id: transaction._id });
          }
        }
        throw err;
      }

      const refreshedQuota = await Quota.findById(quota._id)
        .session(sessionOrNull)
        .select("remainingLiters monthlyLimit usedLiters");

      const receipt = {
        receiptNumber: transaction.receiptNumber,
        status: transaction.status,
        completedAt: transaction.completedAt,
        paymentMethod: transaction.paymentMethod,
        pumpNumber: transaction.pumpNumber,
        liters: transaction.liters,
        fuelType: transaction.fuelType,
        pricePerLiter: transaction.pricePerLiter,
        totalAmount: transaction.totalAmount,
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
            }
          : null,
        booking: {
          id: booking._id,
          fuelType: booking.fuelType,
          approvedLiters: booking.approvedLiters,
          timeSlot: booking.timeSlot,
          bookingDate: booking.bookingDate,
          queueNumber: booking.queueNumber,
        },
        quota: refreshedQuota
          ? {
              remainingLiters: refreshedQuota.remainingLiters,
              monthlyLimit: refreshedQuota.monthlyLimit,
              usedLiters: refreshedQuota.usedLiters,
            }
          : null,
        transactionId: transaction._id,
      };

      return {
        status: 201,
        body: {
          success: true,
          message: "Fuel dispensed",
          data: { receipt },
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate transaction/receipt",
        data: {},
      });
    }
    return next(err);
  }
};

const getMyTransactions = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { from, to, status } = req.query;

    const filter = { driver: driverId };
    if (status) filter.status = String(status).trim();

    if (from || to) {
      const fromDate = from ? normalizeDayStart(from) : null;
      const toDate = to ? normalizeDayEnd(to) : null;

      filter.completedAt = {};
      if (fromDate) filter.completedAt.$gte = fromDate;
      if (toDate) filter.completedAt.$lte = toDate;
      if (Object.keys(filter.completedAt).length === 0)
        delete filter.completedAt;
    }

    const transactions = await Transaction.find(filter)
      .populate("station", "name code city location")
      .sort({ completedAt: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "My transactions",
      data: { transactions },
    });
  } catch (err) {
    return next(err);
  }
};

const getStationTransactions = async (req, res, next) => {
  try {
    const user = req.user;
    const { stationId, from, to, status } = req.query;

    const filter = {};
    if (status) filter.status = String(status).trim();

    if (from || to) {
      const fromDate = from ? normalizeDayStart(from) : null;
      const toDate = to ? normalizeDayEnd(to) : null;

      filter.completedAt = {};
      if (fromDate) filter.completedAt.$gte = fromDate;
      if (toDate) filter.completedAt.$lte = toDate;
      if (Object.keys(filter.completedAt).length === 0)
        delete filter.completedAt;
    }

    if (user.role === "admin") {
      if (stationId) filter.station = stationId;
    } else {
      filter.attendant = user._id;
      if (stationId) filter.station = stationId;
    }

    const transactions = await Transaction.find(filter)
      .populate("driver", "name phone email")
      .populate("station", "name code city location")
      .populate("attendant", "name phone email")
      .sort({ completedAt: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Station transactions",
      data: { transactions },
    });
  } catch (err) {
    return next(err);
  }
};

const getTransactionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id)
      .populate("driver", "name phone email")
      .populate("attendant", "name phone email")
      .populate("station", "name code city location")
      .populate({
        path: "booking",
        populate: [{ path: "vehicle", select: "plateNumber type model color" }],
      })
      .populate("qrCode", "token expiresAt used validatedAt usedAt");

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
        data: {},
      });
    }

    const isAdmin = req.user.role === "admin";
    const isDriverOwner = String(transaction.driver) === String(req.user._id);
    const isAttendantOwner =
      String(transaction.attendant) === String(req.user._id);

    if (!isAdmin && !isDriverOwner && !isAttendantOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
        data: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Transaction",
      data: { transaction },
    });
  } catch (err) {
    return next(err);
  }
};

const reverseTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();

    const result = await runWithOptionalMongoTransaction(async (session) => {
      const sessionOrNull = session || null;

      const tx = await Transaction.findById(id).session(sessionOrNull);
      if (!tx) {
        return {
          status: 404,
          body: { success: false, message: "Transaction not found", data: {} },
        };
      }

      if (tx.status !== "completed") {
        return {
          status: 400,
          body: {
            success: false,
            message: "Only completed transactions can be reversed",
            data: {},
          },
        };
      }

      const litersNum = clampNonNegative(tx.liters);
      const stockPath = getFuelStockPath(tx.fuelType);
      if (!stockPath) {
        return {
          status: 400,
          body: { success: false, message: "Invalid fuel type", data: {} },
        };
      }

      const quota = await Quota.findOne({ driver: tx.driver }).session(
        sessionOrNull,
      );
      if (!quota) {
        return {
          status: 400,
          body: { success: false, message: "Quota not found", data: {} },
        };
      }

      const quotaRes = await Quota.updateOne(
        { _id: quota._id },
        { $inc: { usedLiters: -litersNum } },
        { session: sessionOrNull || undefined },
      );
      if (!quotaRes || quotaRes.modifiedCount !== 1)
        throw new Error("Quota restore failed");

      const stationRes = await Station.updateOne(
        { _id: tx.station },
        { $inc: { [stockPath]: litersNum } },
        { session: sessionOrNull || undefined },
      );
      if (!stationRes || stationRes.modifiedCount !== 1)
        throw new Error("Stock restore failed");

      const refreshedQuota = await Quota.findById(quota._id).session(
        sessionOrNull,
      );
      if (refreshedQuota) {
        refreshedQuota.usedLiters = clampNonNegative(refreshedQuota.usedLiters);
        refreshedQuota.remainingLiters = calculateRemaining(
          refreshedQuota.monthlyLimit,
          refreshedQuota.usedLiters,
        );
        await refreshedQuota.save({ session: sessionOrNull || undefined });
      }

      tx.status = "reversed";
      tx.notes = tx.notes ? String(tx.notes) : "";
      tx.completedAt = tx.completedAt || now;
      await tx.save({ session: sessionOrNull || undefined });

      const populated = await Transaction.findById(tx._id)
        .session(sessionOrNull)
        .populate("driver", "name phone email")
        .populate("station", "name code city location")
        .populate("attendant", "name phone email");

      return {
        status: 200,
        body: {
          success: true,
          message: "Transaction reversed",
          data: { transaction: populated },
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
};

const getReceipt = async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id)
      .populate("driver", "name phone email")
      .populate("station", "name code city location")
      .populate("attendant", "name phone email")
      .populate({
        path: "booking",
        populate: [{ path: "vehicle", select: "plateNumber type model color" }],
      });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
        data: {},
      });
    }

    const isAdmin = req.user.role === "admin";
    const isDriverOwner = String(transaction.driver) === String(req.user._id);
    const isAttendantOwner =
      String(transaction.attendant) === String(req.user._id);

    if (!isAdmin && !isDriverOwner && !isAttendantOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
        data: {},
      });
    }

    const receipt = {
      receiptNumber: transaction.receiptNumber,
      status: transaction.status,
      completedAt: transaction.completedAt,
      paymentMethod: transaction.paymentMethod,
      pumpNumber: transaction.pumpNumber,
      station: transaction.station
        ? {
            name: transaction.station.name,
            code: transaction.station.code,
            city: transaction.station.city,
            location: transaction.station.location,
          }
        : null,
      driver: transaction.driver
        ? {
            name: transaction.driver.name,
            phone: transaction.driver.phone,
            email: transaction.driver.email,
          }
        : null,
      vehicle:
        transaction.booking && transaction.booking.vehicle
          ? {
              plateNumber: transaction.booking.vehicle.plateNumber,
              type: transaction.booking.vehicle.type,
              model: transaction.booking.vehicle.model,
              color: transaction.booking.vehicle.color,
            }
          : null,
      fuel: {
        fuelType: transaction.fuelType,
        liters: transaction.liters,
        pricePerLiter: transaction.pricePerLiter,
        totalAmount: transaction.totalAmount,
      },
      attendant: transaction.attendant
        ? {
            name: transaction.attendant.name,
            phone: transaction.attendant.phone,
            email: transaction.attendant.email,
          }
        : null,
      booking: transaction.booking
        ? {
            id: transaction.booking._id,
            bookingDate: transaction.booking.bookingDate,
            timeSlot: transaction.booking.timeSlot,
            queueNumber: transaction.booking.queueNumber,
          }
        : null,
    };

    return res.status(200).json({
      success: true,
      message: "Receipt",
      data: { receipt },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  dispenseFuel,
  getMyTransactions,
  getStationTransactions,
  getTransactionById,
  reverseTransaction,
  getReceipt,
};
