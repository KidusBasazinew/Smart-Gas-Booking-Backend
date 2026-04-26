const mongoose = require("mongoose");

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw Object.assign(new Error("MONGO_URI is not set"), { statusCode: 500 });
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(mongoUri);

  return mongoose.connection;
};

module.exports = {
  connectDB,
};
