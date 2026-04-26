/* eslint-disable no-console */

const dotenv = require("dotenv");
dotenv.config();

const createApp = require("./app");
const { connectDB } = require("./config/db");

const startServer = async () => {
  try {
    await connectDB();
    console.log("MongoDB connected");

    const app = createApp();

    const port = Number(process.env.PORT || 5000);
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down...`);
      server.close(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

startServer();
