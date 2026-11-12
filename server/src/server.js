import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import twilio from "twilio";
import { pool } from "./db.js";
import {
  hashPassword,
  makeToken,
  requireAuth,
  verifyPassword,
  secret,
} from "./auth.js";
import { readings } from "./readings.js";
import { loadConfig } from "./config.js";
import { logSafeError, requestId, sendError } from "./http.js";

const config = loadConfig();

const app = express();
app.set("trust proxy", config.trustProxyHops);
app.use(helmet());
app.use(cors({ origin: config.clientOrigin }));
app.use(requestId);
app.use(express.json({ limit: "20kb" }));
const limited = (limit, windowMs) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      sendError(
        req,
        res,
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again later.",
      ),
  });
app.use("/api/auth", limited(30, 15 * 60 * 1000));
app.use("/api/otp", limited(100, 10 * 60 * 1000));
const otpIdentityLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) =>
    `otp:${ipKeyGenerator(req.ip)}:${String(req.user?.sub || "-")}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(
      req,
      res,
      429,
      "RATE_LIMITED",
      "Too many phone verification attempts. Please wait and try again.",
    ),
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase().slice(0, 254)
        : "-";
    return `login:${ipKeyGenerator(req.ip)}:${email}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(
      req,
      res,
      429,
      "RATE_LIMITED",
      "Too many login attempts. Please wait and try again.",
    ),
});
app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (e) {
    next(e);
  }
});
app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", async (req, res, next) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password = req.body?.password;
  if (!name || name.length > 100)
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Please enter your name (up to 100 characters).",
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Please enter a valid email address.",
    );
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Password must be between 8 and 72 bytes and at least 8 characters.",
    );
  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,phone,phone_verified_at,tracking_goal,preferred_slot,reminder_enabled",
      [name, email, hash],
    );
    const user = rows[0];
    res.status(201).json({ user, token: makeToken(user) });
  } catch (e) {
    if (e.code === "23505")
      return sendError(
        req,
        res,
        409,
        "EMAIL_ALREADY_EXISTS",
        "An account with this email already exists.",
      );
    next(e);
  }
});
app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password = req.body?.password;
  if (!email || typeof password !== "string")
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Enter your email and password.",
    );
  try {
    const { rows } = await pool.query(
      "SELECT id,name,email,password_hash,phone,phone_verified_at,tracking_goal,preferred_slot,reminder_enabled FROM users WHERE email=$1",
      [email],
    );
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash)))
      return sendError(
        req,
        res,
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const { password_hash, ...user } = rows[0];
    res.json({ user, token: makeToken(user) });
  } catch (e) {
    next(e);
  }
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,name,email,phone,phone_verified_at,tracking_goal,preferred_slot,reminder_enabled FROM users WHERE id=$1",
      [req.user.sub],
    );
    if (!rows[0])
      return sendError(
        req,
        res,
        404,
        "ACCOUNT_NOT_FOUND",
        "Account not found.",
      );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});
app.patch("/api/me", requireAuth, async (req, res, next) => {
  const { goal, preferredSlot, reminderEnabled } = req.body || {};
  const goals = [
    "build_consistency",
    "understand_patterns",
    "share_with_clinician",
  ];
  const slots = ["morning", "after_breakfast", "after_lunch", "after_dinner"];
  if (
    !goals.includes(goal) ||
    !slots.includes(preferredSlot) ||
    typeof reminderEnabled !== "boolean"
  )
    return sendError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      "Choose a goal, preferred time slot, and reminder preference.",
    );
  try {
    const { rows } = await pool.query(
      "UPDATE users SET tracking_goal=$1,preferred_slot=$2,reminder_enabled=$3 WHERE id=$4 RETURNING id,name,email,phone,phone_verified_at,tracking_goal,preferred_slot,reminder_enabled",
      [goal, preferredSlot, reminderEnabled, req.user.sub],
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.post(
  "/api/otp/request",
  requireAuth,
  otpIdentityLimiter,
  async (req, res, next) => {
    const phone =
      typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      return sendError(
        req,
        res,
        400,
        "VALIDATION_ERROR",
        "Enter a phone number in international format, such as +14155552671.",
      );
    if (!config.smsEnabled)
      return sendError(
        req,
        res,
        503,
        "OTP_UNAVAILABLE",
        "Phone verification is unavailable until SMS credentials are configured. You can keep using email and password.",
      );
    try {
      const linked = await pool.query(
        "SELECT id FROM users WHERE phone=$1 AND phone_verified_at IS NOT NULL AND id<>$2",
        [phone, req.user.sub],
      );
      if (linked.rowCount)
        return sendError(
          req,
          res,
          409,
          "PHONE_ALREADY_LINKED",
          "This phone number is already verified on another account.",
        );
      const previous = await pool.query(
        "SELECT next_allowed_at FROM phone_verification_codes WHERE phone=$1",
        [phone],
      );
      if (
        previous.rowCount &&
        new Date(previous.rows[0].next_allowed_at) > new Date()
      )
        return sendError(
          req,
          res,
          429,
          "OTP_COOLDOWN",
          "Please wait before requesting another code.",
        );
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const otpKey = crypto
        .createHmac("sha256", secret())
        .update("Sweety phone verification code v1")
        .digest();
      const codeHash = crypto
        .createHmac("sha256", otpKey)
        .update(`${phone}:${code}`)
        .digest("hex");
      await pool.query(
        `INSERT INTO phone_verification_codes(phone,code_hash,expires_at,next_allowed_at,attempts)
      VALUES($1,$2,now()+interval '5 minutes',now()+interval '60 seconds',0)
      ON CONFLICT(phone) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,next_allowed_at=EXCLUDED.next_allowed_at,attempts=0`,
        [phone, codeHash],
      );
      const domain = config.webOtpDomain;
      const message = `Your Sweety verification code is ${code}.\n\n@${domain} #${code}`;
      try {
        await twilio(
          config.twilioAccountSid,
          config.twilioAuthToken,
        ).messages.create({
          body: message,
          from: config.twilioPhoneNumber,
          to: phone,
        });
      } catch (e) {
        await pool.query(
          "DELETE FROM phone_verification_codes WHERE phone=$1",
          [phone],
        );
        throw e;
      }
      res.status(202).json({
        message:
          "Code sent. Enter it here or use your device’s one-time-code suggestion.",
      });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/otp/verify",
  requireAuth,
  otpIdentityLimiter,
  async (req, res, next) => {
    const phone =
      typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code))
      return sendError(
        req,
        res,
        400,
        "VALIDATION_ERROR",
        "Enter the phone number and six-digit code.",
      );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT code_hash,expires_at,attempts FROM phone_verification_codes WHERE phone=$1 FOR UPDATE",
        [phone],
      );
      if (
        !rows[0] ||
        new Date(rows[0].expires_at) < new Date() ||
        rows[0].attempts >= 5
      ) {
        await client.query(
          "DELETE FROM phone_verification_codes WHERE phone=$1",
          [phone],
        );
        await client.query("COMMIT");
        return sendError(
          req,
          res,
          400,
          "OTP_EXPIRED",
          "Code expired or unavailable. Request a new code.",
        );
      }
      const otpKey = crypto
        .createHmac("sha256", secret())
        .update("Sweety phone verification code v1")
        .digest();
      const supplied = crypto
        .createHmac("sha256", otpKey)
        .update(`${phone}:${code}`)
        .digest();
      const expected = Buffer.from(rows[0].code_hash, "hex");
      if (
        expected.length !== supplied.length ||
        !crypto.timingSafeEqual(expected, supplied)
      ) {
        await client.query(
          "UPDATE phone_verification_codes SET attempts=attempts+1 WHERE phone=$1",
          [phone],
        );
        await client.query("COMMIT");
        return sendError(
          req,
          res,
          400,
          "OTP_INVALID",
          "That code is incorrect.",
        );
      }
      await client.query(
        "UPDATE users SET phone=$1,phone_verified_at=now() WHERE id=$2",
        [phone, req.user.sub],
      );
      await client.query(
        "DELETE FROM phone_verification_codes WHERE phone=$1",
        [phone],
      );
      await client.query("COMMIT");
      res.json({ verified: true, phone });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505")
        return sendError(
          req,
          res,
          409,
          "PHONE_ALREADY_LINKED",
          "This phone number is already linked to an account.",
        );
      next(e);
    } finally {
      client.release();
    }
  },
);

app.use("/api/readings", readings);
app.use("/api", (req, res) =>
  sendError(req, res, 404, "ROUTE_NOT_FOUND", "API route not found."),
);
app.use((err, req, res, _next) => {
  logSafeError(req, err);
  if (err.type === "entity.parse.failed") {
    return sendError(
      req,
      res,
      400,
      "INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
  if (err.type === "entity.too.large") {
    return sendError(
      req,
      res,
      413,
      "BODY_TOO_LARGE",
      "Request body is too large.",
    );
  }
  return sendError(
    req,
    res,
    500,
    "INTERNAL_ERROR",
    "Something went wrong. Please try again.",
  );
});
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(config.port, () =>
    console.log(`Sweety API listening at http://localhost:${config.port}`),
  );
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      pool.end().catch(() => {
        process.exitCode = 1;
      });
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, shutdown);
  }
}
export default app;
