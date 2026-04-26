/* eslint-disable no-console */

const dotenv = require("dotenv");
dotenv.config();

const { connectDB } = require("../config/db");
const quotaController = require("../controllers/quotaController");

const run = async () => {
  await connectDB();

  const mockReq = { user: { role: "admin" } };
  const mockRes = {
    status: () => mockRes,
    json: (body) => {
      console.log(JSON.stringify(body, null, 2));
    },
  };

  await quotaController.resetMonthlyQuotaForAll(mockReq, mockRes, (err) => {
    if (err) console.error(err);
  });

  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
