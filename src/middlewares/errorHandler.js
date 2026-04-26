/* eslint-disable no-console */

const errorHandler = (err, req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";

  let statusCode = err.statusCode || 500;
  let message = err.message || "Server error";

  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation error";
  }

  if (err.code === 11000) {
    statusCode = 409;
    const keys = err.keyValue ? Object.keys(err.keyValue) : [];
    message = keys.length
      ? `Duplicate value for: ${keys.join(", ")}`
      : "Duplicate key error";
  }

  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid resource identifier";
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Invalid or expired token";
  }

  if (!isProd) {
    console.error(err);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    ...(isProd
      ? {}
      : {
          stack: err.stack,
        }),
  });
};

module.exports = errorHandler;
