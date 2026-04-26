const bcrypt = require("bcryptjs");

const hashPassword = async (plainPassword) => {
  const saltRounds = 12;
  return bcrypt.hash(plainPassword, saltRounds);
};

const comparePassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

module.exports = {
  hashPassword,
  comparePassword,
};
