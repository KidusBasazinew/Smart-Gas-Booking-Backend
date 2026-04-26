const parseTimeSlot = (timeSlot) => {
  const value = String(timeSlot || "").trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(
    value,
  );
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (endTotal <= startTotal) return null;

  return {
    startHour,
    startMinute,
    endHour,
    endMinute,
    startTotal,
    endTotal,
    normalized: value,
  };
};

const getSlotStartEnd = (bookingDate, timeSlot) => {
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return null;

  const date = new Date(bookingDate);
  if (Number.isNaN(date.getTime())) return null;

  const start = new Date(date);
  start.setHours(parsed.startHour, parsed.startMinute, 0, 0);

  const end = new Date(date);
  end.setHours(parsed.endHour, parsed.endMinute, 0, 0);

  return {
    start,
    end,
    parsed,
  };
};

const isBeforeCutoff = (slotStart, minutesBefore) => {
  const cutoff = new Date(slotStart.getTime() - minutesBefore * 60 * 1000);
  return new Date() < cutoff;
};

module.exports = {
  parseTimeSlot,
  getSlotStartEnd,
  isBeforeCutoff,
};
