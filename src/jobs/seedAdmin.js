/* eslint-disable no-console */

const dotenv = require("dotenv");
dotenv.config();

const { connectDB } = require("../config/db");
const User = require("../models/User");
const { hashPassword } = require("../utils/password");

const seedAdmin = async () => {
  const name = process.env.ADMIN_NAME || "System Admin";
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const phone = (process.env.ADMIN_PHONE || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !phone || !password) {
    throw new Error("ADMIN_EMAIL, ADMIN_PHONE, and ADMIN_PASSWORD must be set");
  }

  await connectDB();

  const existing = await User.findOne({ email });
  if (existing) {
    console.log("Admin already exists:", existing.email);
    process.exit(0);
  }

  const admin = await User.create({
    name,
    email,
    phone,
    password: await hashPassword(password),
    role: "admin",
    isApproved: true,
    isBlocked: false,
  });

  console.log("Admin created:", admin.email);
  process.exit(0);
};

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
