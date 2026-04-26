const pad2 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "00";
  return String(v).padStart(2, "0");
};

const formatYYYYMMDD = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "00000000";
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}${m}${day}`;
};

const randomDigits = (count) => {
  const n = Number(count);
  const len = Number.isFinite(n) && n >= 3 && n <= 10 ? n : 4;
  const max = 10 ** len;
  const value = Math.floor(Math.random() * max);
  return String(value).padStart(len, "0");
};

const generateReceiptNumber = (date = new Date()) => {
  const datePart = formatYYYYMMDD(date);
  const suffix = randomDigits(4);
  return `RCP-${datePart}-${suffix}`;
};

module.exports = {
  formatYYYYMMDD,
  generateReceiptNumber,
};
