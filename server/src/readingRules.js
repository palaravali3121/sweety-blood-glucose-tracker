export const slots = [
  "morning",
  "after_breakfast",
  "after_lunch",
  "after_dinner",
];
export const slotLabels = {
  morning: "Morning (fasting)",
  after_breakfast: "After breakfast",
  after_lunch: "After lunch",
  after_dinner: "After dinner",
};

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function validateReading(body, now = new Date()) {
  if (body.value === undefined || body.value === null || body.value === "")
    return "Please enter a glucose value.";
  if (
    !Number.isInteger(Number(body.value)) ||
    Number(body.value) < 40 ||
    Number(body.value) > 600
  )
    return "Value must be between 40 and 600 mg/dl.";
  if (!isValidDate(body.date)) return "Please enter a valid date.";
  if (body.date > now.toISOString().slice(0, 10))
    return "Date cannot be in the future.";
  if (!slots.includes(body.slot)) return "Please select a valid time slot.";
  return null;
}

export function reportPeriods(date) {
  if (!isValidDate(date))
    throw new Error("date must be a valid YYYY-MM-DD calendar date");
  const [year, month] = date.split("-").map(Number);
  const monthStart = `${date.slice(0, 7)}-01`;
  return {
    daily: { from: date, to: date },
    monthToDate: { from: monthStart, to: date },
    previousMonth: {
      from: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
    },
  };
}

export function summarizeReadings(items, from, to) {
  return {
    from,
    to,
    count: items.length,
    highest: items.length ? Math.max(...items.map((item) => item.value)) : null,
    lowest: items.length ? Math.min(...items.map((item) => item.value)) : null,
    average: items.length
      ? Math.round(
          (items.reduce((sum, item) => sum + item.value, 0) / items.length) *
            10,
        ) / 10
      : null,
  };
}
