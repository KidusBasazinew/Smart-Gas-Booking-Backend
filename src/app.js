const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const stationRoutes = require("./routes/stationRoutes");
const quotaRoutes = require("./routes/quotaRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const qrRoutes = require("./routes/qrRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const adminRoutes = require("./routes/adminRoutes");
const reportRoutes = require("./routes/reportRoutes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(cors());

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/vehicles", vehicleRoutes);
  app.use("/api/stations", stationRoutes);
  app.use("/api/quotas", quotaRoutes);
  app.use("/api/bookings", bookingRoutes);
  app.use("/api/qr", qrRoutes);
  app.use("/api/transactions", transactionRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/reports", reportRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
