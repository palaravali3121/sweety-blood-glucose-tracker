import { Router } from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { sendError } from "./http.js";
import {
  isValidDate,
  reportPeriods,
  slotLabels,
  slots,
  summarizeReadings,
  validateReading,
} from "./readingRules.js";

export { slots, slotLabels };
export const readings = Router();
readings.use(requireAuth);
const today = () => new Date().toISOString().slice(0, 10);
const isId = (id) => /^\d+$/.test(id);

readings.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,reading_date::text AS date,slot,value FROM readings WHERE user_id=$1 ORDER BY reading_date DESC,slot",
      [req.user.sub],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});
readings.post("/", async (req, res, next) => {
  const error = validateReading(req.body || {});
  if (error) return sendError(req, res, 400, "VALIDATION_ERROR", error);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
      [String(req.user.sub), req.body.date],
    );
    const count = await client.query(
      "SELECT count(*)::int AS n FROM readings WHERE user_id=$1 AND reading_date=$2",
      [req.user.sub, req.body.date],
    );
    if (count.rows[0].n >= 4) {
      await client.query("ROLLBACK");
      return sendError(
        req,
        res,
        409,
        "DAILY_LIMIT_REACHED",
        "You can add only 4 readings per day.",
      );
    }
    const { rows } = await client.query(
      "INSERT INTO readings(user_id,reading_date,slot,value) VALUES($1,$2,$3,$4) RETURNING id,reading_date::text AS date,slot,value",
      [req.user.sub, req.body.date, req.body.slot, Number(req.body.value)],
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505")
      return sendError(
        req,
        res,
        409,
        "DUPLICATE_SLOT",
        `You already have an ${slotLabels[req.body.slot]} reading for this date.`,
      );
    next(e);
  } finally {
    client.release();
  }
});
readings.put("/:id", async (req, res, next) => {
  if (!isId(req.params.id))
    return sendError(req, res, 400, "INVALID_ID", "Invalid reading id.");
  const error = validateReading(req.body || {});
  if (error) return sendError(req, res, 400, "VALIDATION_ERROR", error);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const own = await client.query(
      "SELECT id,reading_date::text AS date FROM readings WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [req.params.id, req.user.sub],
    );
    if (!own.rowCount) {
      await client.query("ROLLBACK");
      return sendError(
        req,
        res,
        404,
        "READING_NOT_FOUND",
        "Reading not found.",
      );
    }
    for (const day of [...new Set([own.rows[0].date, req.body.date])].sort())
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [String(req.user.sub), day],
      );
    const dup = await client.query(
      "SELECT 1 FROM readings WHERE user_id=$1 AND reading_date=$2 AND slot=$3 AND id<>$4",
      [req.user.sub, req.body.date, req.body.slot, req.params.id],
    );
    if (dup.rowCount) {
      await client.query("ROLLBACK");
      return sendError(
        req,
        res,
        409,
        "DUPLICATE_SLOT",
        `You already have an ${slotLabels[req.body.slot]} reading for this date.`,
      );
    }
    const count = await client.query(
      "SELECT count(*)::int AS n FROM readings WHERE user_id=$1 AND reading_date=$2 AND id<>$3",
      [req.user.sub, req.body.date, req.params.id],
    );
    if (count.rows[0].n >= 4) {
      await client.query("ROLLBACK");
      return sendError(
        req,
        res,
        409,
        "DAILY_LIMIT_REACHED",
        "You can add only 4 readings per day.",
      );
    }
    const { rows } = await client.query(
      "UPDATE readings SET reading_date=$1,slot=$2,value=$3 WHERE id=$4 AND user_id=$5 RETURNING id,reading_date::text AS date,slot,value",
      [
        req.body.date,
        req.body.slot,
        Number(req.body.value),
        req.params.id,
        req.user.sub,
      ],
    );
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505")
      return sendError(
        req,
        res,
        409,
        "DUPLICATE_SLOT",
        `You already have an ${slotLabels[req.body.slot]} reading for this date.`,
      );
    next(e);
  } finally {
    client.release();
  }
});
readings.delete("/:id", async (req, res, next) => {
  if (!isId(req.params.id))
    return sendError(req, res, 400, "INVALID_ID", "Invalid reading id.");
  try {
    const result = await pool.query(
      "DELETE FROM readings WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.sub],
    );
    if (!result.rowCount)
      return sendError(
        req,
        res,
        404,
        "READING_NOT_FOUND",
        "Reading not found.",
      );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
readings.get("/reports", async (req, res, next) => {
  const date = req.query.date;
  if (!isValidDate(date))
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Please select a valid date.",
    );
  if (date > today())
    return sendError(
      req,
      res,
      400,
      "FUTURE_DATE",
      "Date cannot be in the future.",
    );
  const periods = reportPeriods(date);
  try {
    const { rows } = await pool.query(
      `SELECT reading_date::text AS date,slot,value FROM readings WHERE user_id=$1 AND reading_date >= $2 AND reading_date <= $3 ORDER BY reading_date,slot`,
      [req.user.sub, periods.previousMonth.from, date],
    );
    const daily = rows.filter((item) => item.date === date);
    const monthToDate = rows.filter(
      (item) => item.date >= periods.monthToDate.from,
    );
    const previous = rows.filter(
      (item) => item.date < periods.monthToDate.from,
    );
    res.json({
      daily: {
        ...summarizeReadings(daily, periods.daily.from, periods.daily.to),
        readings: daily,
      },
      monthToDate: summarizeReadings(
        monthToDate,
        periods.monthToDate.from,
        periods.monthToDate.to,
      ),
      previousMonth: summarizeReadings(
        previous,
        periods.previousMonth.from,
        periods.previousMonth.to,
      ),
    });
  } catch (e) {
    next(e);
  }
});
