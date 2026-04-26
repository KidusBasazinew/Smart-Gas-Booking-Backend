const { isValidObjectId } = require("../utils/objectId");

const validateObjectIdParam = (paramName) => {
  return (req, res, next) => {
    const value = req.params[paramName];

    if (!isValidObjectId(value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName}`,
      });
    }

    return next();
  };
};

module.exports = validateObjectIdParam;
