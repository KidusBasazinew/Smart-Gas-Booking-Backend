const mongoose = require("mongoose");

const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(String(value));
};

module.exports = {
  isValidObjectId,
};
