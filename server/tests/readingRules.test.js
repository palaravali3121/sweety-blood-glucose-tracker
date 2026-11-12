import test from "node:test";
import assert from "node:assert/strict";
import {
  reportPeriods,
  summarizeReadings,
  validateReading,
} from "../src/readingRules.js";

test("validates all four required time slots and glucose range", () => {
  const base = { date: "2026-11-11", slot: "morning", value: 40 };
  assert.equal(validateReading(base, new Date("2026-11-11T12:00:00Z")), null);
  assert.equal(
    validateReading({ ...base, value: 600 }, new Date("2026-11-11T12:00:00Z")),
    null,
  );
  assert.equal(
    validateReading({ ...base, value: "" }),
    "Please enter a glucose value.",
  );
  assert.equal(
    validateReading({ ...base, value: 39 }),
    "Value must be between 40 and 600 mg/dl.",
  );
  assert.equal(
    validateReading({ ...base, value: 40.5 }),
    "Value must be between 40 and 600 mg/dl.",
  );
  assert.equal(
    validateReading({ ...base, slot: "bedtime" }),
    "Please select a valid time slot.",
  );
});

test("rejects invalid and future calendar dates", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assert.equal(
    validateReading({ date: "2026-02-30", slot: "morning", value: 100 }, now),
    "Please enter a valid date.",
  );
  assert.equal(
    validateReading({ date: "2026-11-12", slot: "morning", value: 100 }, now),
    "Date cannot be in the future.",
  );
});

test("calculates month periods across the January year boundary", () => {
  assert.deepEqual(reportPeriods("2026-01-15"), {
    daily: { from: "2026-01-15", to: "2026-01-15" },
    monthToDate: { from: "2026-01-01", to: "2026-01-15" },
    previousMonth: { from: "2025-12-01", to: "2025-12-31" },
  });
});

test("summarizes values to one decimal and returns a complete empty state", () => {
  assert.deepEqual(
    summarizeReadings(
      [{ value: 100 }, { value: 111 }],
      "2026-10-01",
      "2026-10-02",
    ),
    {
      from: "2026-10-01",
      to: "2026-10-02",
      count: 2,
      highest: 111,
      lowest: 100,
      average: 105.5,
    },
  );
  assert.deepEqual(summarizeReadings([], "2026-10-01", "2026-10-02"), {
    from: "2026-10-01",
    to: "2026-10-02",
    count: 0,
    highest: null,
    lowest: null,
    average: null,
  });
});
