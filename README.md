# Sweety — Blood Glucose Tracker

Standalone full-stack responsive web app. It is not part of the Rivo repository. The runnable source is in `server/` and `client/`; this guide explains the build and run steps. The original challenge’s required features are implemented: email/password auth with bcrypt, user-owned glucose readings, CRUD, validation, and daily/month-to-date/previous-month reports. The optional onboarding and OTP portions are limited to preference setup and optional phone verification. The interface works in a mobile browser; the assignment asks for React web, so this project does not build native iOS/Android packages.

> Health data in this demo is sensitive. Use fake data only. This is a tracking tool, not medical advice or a clinical system.

## Stack and prerequisites

- Node.js 24 LTS (or another maintained LTS line), npm, PostgreSQL 16+, and an editor.
- Express 5 API, PostgreSQL (`pg`), React + Vite, bcryptjs, JWT, Helmet security headers, and rate limiting.
- Optional SMS: Twilio Programmable Messaging credentials. Without these, all required email/password and glucose functionality works; SMS verification is disabled.

Install a maintained Node LTS: [Node.js releases](https://nodejs.org/en/about/previous-releases). Express 5 requires Node 18+: [Express installation](https://expressjs.com/en/5x/starter/installing/).

### Practices reused from the Rivo backend

The reference backend is Go, so its code and packages are not copied into this JavaScript assignment. Sweety uses the same useful ideas in its required stack: fail-fast environment validation, bounded request bodies, structured error codes plus request IDs, redacted error logs, auth-specific rate limits, versioned SQL migrations, owner-scoped data access, transaction locks for daily caps, and focused tests for edge cases. Redis, MongoDB, the event bus, and Rivo’s finance-specific layers would add setup without helping this small app.

## Step 1 — create database and backend

From this directory:

```sh
cd server
npm install
```

Create PostgreSQL role and database (run as a PostgreSQL administrator):

```sql
CREATE USER sweety_app WITH PASSWORD 'replace-with-a-local-password';
CREATE DATABASE sweety OWNER sweety_app;
```

Copy `server/.env.example` to `server/.env`, set `DATABASE_URL`, and generate `JWT_SECRET` with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Keep `.env` private. Required and optional environment variables are documented in the example file.

Apply the baseline schema through the migration runner:

```sh
cd server
npm run migrate
```

The runner tracks applied versions in `schema_migrations` and wraps each migration in a transaction. `schema.sql` is the initial version. Add later changes as new `server/migrations/NNNN_description.sql` files; do not edit an already-applied migration. The `TRUST_PROXY_HOPS` setting must match the actual reverse-proxy path; leave it at `0` for local development.

The backend has these files:

```text
server/
  package.json
  .env.example
  schema.sql
  src/server.js
  src/db.js
  src/auth.js
  src/config.js
  src/http.js
  src/readingRules.js
  src/readings.js
  scripts/migrate.js
  scripts/seed.js
  tests/api.test.js
  tests/config.test.js
  tests/readingRules.test.js
  tests/database.integration.test.js
  migrations/
```

## Step 2 — API and business logic

Start the API from `server/` using `npm run dev`. It listens on port 4000. `GET /api/health/live` checks the process; `GET /api/health` checks PostgreSQL readiness. All private requests require `Authorization: Bearer <token>`.

| Method | Endpoint                                | Purpose                                                     |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/auth/register`                    | `{name,email,password}` creates account and returns token   |
| POST   | `/api/auth/login`                       | `{email,password}` returns token                            |
| GET    | `/api/me`                               | current user and saved onboarding preferences               |
| PATCH  | `/api/me`                               | `{goal,preferredSlot,reminderEnabled}` saves onboarding     |
| GET    | `/api/readings`                         | caller’s readings only                                      |
| POST   | `/api/readings`                         | `{date,slot,value}` adds reading                            |
| PUT    | `/api/readings/:id`                     | changes an owned reading                                    |
| DELETE | `/api/readings/:id`                     | deletes an owned reading                                    |
| GET    | `/api/readings/reports?date=YYYY-MM-DD` | daily, month-to-date, prior-month statistics                |
| POST   | `/api/otp/request`                      | optional phone verification SMS; requires configured Twilio |
| POST   | `/api/otp/verify`                       | verifies SMS code and marks the user’s phone verified       |

Time slots: `morning`, `after_breakfast`, `after_lunch`, `after_dinner`. Values are whole mg/dL numbers from 40 through 600. One slot per day and at most four readings per day. The database unique key protects duplicate slots; an advisory transaction lock protects the four-reading limit during concurrent writes. Owner filtering happens in SQL for every read/update/delete. Errors include a readable `error`, stable `code`, and `requestId`; the frontend displays the readable message.

Reports return `null` high/low/average for an empty period and a count of zero. Daily includes the slot list. Averages round to one decimal. Dates are calendar-date strings, not timestamps.

## Step 3 — frontend and onboarding

In a second terminal:

```sh
cd client
npm install
```

Copy `client/.env.example` to `client/.env`, then run `npm run dev` and open the Vite URL shown in the terminal (usually `http://localhost:5173`). The interface is white with soft pink accents, responsive cards, form validation messages, and small entrance/hover animations. It honors `prefers-reduced-motion`.

### Open it on a phone on the same Wi-Fi

For manual UI testing on a physical phone, set `VITE_API_URL` in `client/.env` to `http://<computer-LAN-IP>:4000/api`, set `CLIENT_ORIGIN` in `server/.env` to the exact phone-facing web origin (for example `http://192.168.1.20:5173`), then start Vite with `npm run dev -- --host 0.0.0.0`. Keep `TRUST_PROXY_HOPS=0` when running locally and allow the development ports through the local firewall only on the trusted network. Plain HTTP on a LAN IP is not a secure context for WebOTP, so use manual code entry there; SMS auto-capture requires HTTPS and a compatible browser/device.

After account creation, a short onboarding asks the user’s tracking goal, a preferred logging slot, and whether they want a reminder preference saved. It does not send reminders (no scheduler/service is part of the challenge), and it does not ask the user to disclose a diagnosis. User can finish or skip it.

## Step 4 — auth, OTP and protection

- Passwords are hashed with bcrypt (12 rounds); plaintext is never stored or returned.
- Email is trimmed and lowercased. Password length is bounded. JWTs expire after seven days.
- Startup validates the database URL, JWT secret, port, CORS origin, optional Twilio settings, and proxy-hop count.
- JWT signing key is mandatory and must be at least 32 bytes.
- SQL uses parameters. Foreign keys cascade a user’s records on account deletion; the demo has no account-deletion UI.
- Reading date/value/slot checks happen in the API and in PostgreSQL. Frontend checks improve feedback but are not trusted.
- Optional SMS verification uses a short-lived hashed code, cooldown, attempt limit, and Twilio; do not expose provider secrets to Vite.
- SMS auto-fill uses `autocomplete="one-time-code"` and the WebOTP API when supported. Browser auto-retrieval requires a specially formatted origin-bound SMS, secure context, compatible device/browser, and user consent. Manual code entry always remains available. See [MDN WebOTP](https://developer.mozilla.org/en-US/docs/Web/API/WebOTP_API) and [MDN OTP guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/OTP).
- Do not treat SMS alone as strong authentication; it is phone verification only. MDN advises against SMS OTP alone for new sessions. Passwords are the login method in this assignment.
- The bearer token is stored in localStorage for a simple learning project. Auth and OTP routes have in-memory rate limits; login attempts are keyed by both IP and normalized email, while OTP attempts also have an IP limit and a phone cooldown. This store is per-process and resets on restart. For production, use a security-reviewed session design (for example, HttpOnly/SameSite cookies with CSRF defenses), a shared rate-limit store, HTTPS, monitoring, tested account recovery, and a privacy review. Do not deploy this educational app with real patient data.

If OTP is enabled, set Twilio variables and the public app hostname in `server/.env`. Configure an SMS sender that supports the required final SMS line `@your-domain #123456`; some managed verification templates cannot guarantee this format. Localhost and unsupported browsers use manual entry. Twilio billing/verification may be required.

## Step 5 — seed, tests and Mermaid overview

Run `npm run migrate` then `npm run seed` inside `server/`; demo login is `demo@sweety.local` / `SweetyDemo123!`. Change or remove demo credentials before any public deployment. Seed is safe to rerun and updates sample values.

Run API checks with `npm test` inside `server/`; unit and HTTP checks do not require PostgreSQL. Set `TEST_DATABASE_URL` to a disposable local PostgreSQL database whose migrations have been applied to also run the integration test for concurrent insert limits, owner isolation, report summaries, and edits into a full day. Never point it at production or real patient data. Run a frontend production build with `npm run build` inside `client/`. Tests cover startup config validation, glucose/date/report rules, API auth errors, request IDs, malformed JSON, and daily-limit concurrency when a test database is configured.

```mermaid
flowchart LR
  Browser[React UI] -->|JSON + bearer token| API[Express API]
  API -->|Parameterized SQL| DB[(PostgreSQL)]
  API --> Auth[JWT and bcrypt]
  API -->|Optional phone verification| SMS[Twilio SMS]
  Browser -->|Origin-bound SMS consent when supported| OTP[WebOTP autofill]
  OTP --> Browser
```

## Step 6 — seed and run everything

Terminal A:

```sh
cd server
npm install
npm run migrate
npm run seed
npm run dev
```

Terminal B:

```sh
cd client
npm install
npm run dev
```

Open the Vite URL. Try registering, logging in, completing/skipping onboarding, recording four different slots on one date, trying the fifth slot/day limit, editing/deleting a record, and selecting dates to inspect all three reports. To test another account, register a second user and confirm their readings are isolated.

## Tests and submission checklist

```sh
# server
npm test

# client
npm run build
```

- [ ] Fresh database schema applied; seed works twice.
- [ ] Registration/login work; no password hash leaks; invalid credentials return generic errors.
- [ ] Two accounts cannot view or change each other’s readings.
- [ ] Blank, non-integer, under/over range, invalid/future date, duplicate slot and fifth/day are rejected with clear messages.
- [ ] Editing also preserves the unique-slot and daily-limit rules.
- [ ] Reports checked on empty ranges, month boundaries, January rollover, and rounded averages.
- [ ] `.env` excluded; `.env.example` has placeholders only; public repo contains no actual SMS credentials or personal data.
- [ ] Screenshot/video shows login, onboarding, reading CRUD, validation and reports.
- [ ] README Notes disclose assumptions and remaining production work; commits are small and truthful.

## Known limits and assumptions

This is an assignment-scale educational app. It uses localStorage bearer tokens, has no password reset/email verification, no CSRF/session-cookie architecture, no shared rate-limit store, no deployed SMS service configuration, and no actual reminder scheduler. The daily maximum uses a per-user/per-date PostgreSQL advisory transaction lock for create and edit operations, alongside the unique slot constraint. Add a concurrency integration test when a PostgreSQL test database is available. The app defines its date as the UTC calendar day so browser and API limits agree; a localized deployment should save each user's timezone and use it consistently in validation and report boundaries. The simple migration runner has no automatic down migrations; back up the database and write a reviewed forward migration. These are explicit follow-up tasks, not hidden behavior.

## Source files

The complete backend and frontend code are maintained in this directory and can be copied into an IDE as-is. `.env` files are intentionally not included; use the examples and your own local secrets.

## Appendix A — full copy-ready project source

Each block below is the complete current source/config file at the matching path. Dependency lockfiles are included in the project folder and ZIP; npm regenerates them if needed. The .env.example files contain placeholders; create private .env files locally and never copy actual secrets into the repository.

### `server/package.json`

```json
{
  "name": "sweety-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "migrate": "node scripts/migrate.js",
    "seed": "node scripts/seed.js",
    "test": "node --test",
    "format": "prettier --write package.json src/*.js scripts/*.js tests/*.js ../client/package.json ../client/src/*.jsx ../client/src/*.css ../client/index.html ../README.md"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^5.1.0",
    "express-rate-limit": "^8.2.1",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.16.3",
    "twilio": "^5.10.0"
  },
  "devDependencies": {
    "prettier": "^3.9.10",
    "supertest": "^7.1.4"
  }
}
```

### `server/.env.example`

```dotenv
PORT=4000
DATABASE_URL=postgresql://sweety_app:replace-with-a-local-password@localhost:5432/sweety
# Optional database-backed tests. Use a disposable local DB, never production.
TEST_DATABASE_URL=
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
CLIENT_ORIGIN=http://localhost:5173
# Only set when deployed behind a known reverse proxy; use its exact hop count.
TRUST_PROXY_HOPS=0
# Optional. Leave blank to disable phone verification.
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
# Domain without scheme or port for the origin-bound WebOTP SMS final line.
WEBOTP_DOMAIN=localhost

```

### `server/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT UNIQUE,
  phone_verified_at TIMESTAMPTZ,
  tracking_goal TEXT CHECK (tracking_goal IN ('build_consistency','understand_patterns','share_with_clinician')),
  preferred_slot TEXT CHECK (preferred_slot IN ('morning','after_breakfast','after_lunch','after_dinner')),
  reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS readings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning','after_breakfast','after_lunch','after_dinner')),
  value INTEGER NOT NULL CHECK (value BETWEEN 40 AND 600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, reading_date, slot)
);
CREATE INDEX IF NOT EXISTS readings_user_date_idx ON readings(user_id, reading_date);

CREATE TABLE IF NOT EXISTS phone_verification_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  next_allowed_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

```

### `server/src/auth.js`

```js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendError } from "./http.js";

export function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  return process.env.JWT_SECRET;
}
export const makeToken = (user) =>
  jwt.sign({ sub: String(user.id), name: user.name }, secret(), {
    expiresIn: "7d",
  });
export async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer "))
    return sendError(req, res, 401, "AUTH_REQUIRED", "Please log in.");
  try {
    req.user = jwt.verify(header.slice(7), secret());
    return next();
  } catch {
    return sendError(
      req,
      res,
      401,
      "INVALID_TOKEN",
      "Your session is invalid or expired. Please log in again.",
    );
  }
}
export const hashPassword = (value) => bcrypt.hash(value, 12);
export const verifyPassword = (value, hash) => bcrypt.compare(value, hash);
```

### `server/src/config.js`

```js
export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }

  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");

  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 5
  ) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5");
  }

  const clientOrigin = env.CLIENT_ORIGIN || "http://localhost:5173";
  let origin;
  try {
    origin = new URL(clientOrigin);
  } catch {
    throw new Error("CLIENT_ORIGIN must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== clientOrigin.replace(/\/$/, "")
  ) {
    throw new Error(
      "CLIENT_ORIGIN must be one exact http or https origin without a path",
    );
  }

  const smsValues = [
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_AUTH_TOKEN,
    env.TWILIO_PHONE_NUMBER,
  ];
  if (smsValues.some(Boolean) && !smsValues.every(Boolean)) {
    throw new Error("Set all three Twilio variables or leave all three blank");
  }
  const webOtpDomain = env.WEBOTP_DOMAIN || "localhost";
  if (!/^(localhost|[a-z0-9.-]+)$/i.test(webOtpDomain))
    throw new Error(
      "WEBOTP_DOMAIN must be a domain name without scheme, path, or port",
    );

  return {
    port,
    trustProxyHops,
    databaseUrl,
    jwtSecret,
    clientOrigin: origin.origin,
    smsEnabled: smsValues.every(Boolean),
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
    webOtpDomain,
  };
}
```

### `server/src/db.js`

```js
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", source: "postgres_pool", code: error.code || error.name || "unexpected_error" })}\n`,
  );
});
```

### `server/src/http.js`

```js
import crypto from "node:crypto";

export function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

export function sendError(req, res, status, code, message, details) {
  return res.status(status).json({
    error: message,
    code,
    requestId: req.id,
    ...(details ? { details } : {}),
  });
}

export function logSafeError(req, error) {
  // Avoid writing request bodies, phone numbers, SQL parameters, or provider messages to logs.
  process.stderr.write(
    `${JSON.stringify({ level: "error", requestId: req.id, path: req.path, code: error.code || error.name || "unexpected_error" })}\n`,
  );
}
```

### `server/src/readingRules.js`

```js
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
```

### `server/src/readings.js`

```js
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
```

### `server/src/server.js`

```js
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
```

### `server/scripts/migrate.js`

```js
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../src/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const baseline = path.join(here, "..", "schema.sql");
const migrationLock = 748293104;

try {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    await client.query("SELECT pg_advisory_lock($1)", [migrationLock]);
    lockAcquired = true;

    const names = (await readdir(migrationsDir))
      .filter((name) => /^\d{4,}_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();
    const files = [
      ["0000_schema", baseline],
      ...names.map((name) => [
        name.slice(0, -4),
        path.join(migrationsDir, name),
      ]),
    ];
    const applied = await client.query("SELECT version FROM schema_migrations");
    const done = new Set(applied.rows.map((row) => row.version));

    for (const [version, file] of files) {
      if (done.has(version)) continue;
      const sql = await readFile(file, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES($1)",
          [version],
        );
        await client.query("COMMIT");
        console.log(`Applied database migration ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1)", [migrationLock]);
      }
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
```

### `server/scripts/seed.js`

```js
import "dotenv/config";
import { pool } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
try {
  const hash = await hashPassword("SweetyDemo123!");
  const { rows } = await pool.query(
    `INSERT INTO users(name,email,password_hash,tracking_goal,preferred_slot) VALUES('Sweety Demo','demo@sweety.local',$1,'build_consistency','morning') ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [hash],
  );
  const userId = rows[0].id;
  const now = new Date();
  for (const [offset, slot, value] of [
    [0, "morning", 105],
    [0, "after_breakfast", 142],
    [0, "after_lunch", 128],
    [0, "after_dinner", 119],
    [1, "morning", 101],
    [2, "morning", 112],
  ]) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - offset);
    const date = day.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO readings(user_id,reading_date,slot,value) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,reading_date,slot) DO UPDATE SET value=EXCLUDED.value`,
      [userId, date, slot, value],
    );
  }
  console.log("Demo login: demo@sweety.local / SweetyDemo123!");
} finally {
  await pool.end();
}
```

### `server/tests/api.test.js`

```js
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET ||=
  "test-only-secret-value-that-is-at-least-32-characters-long";
let request, app, token;
let secondUserToken;
before(async () => {
  ({ default: app } = await import("../src/server.js"));
  ({ default: request } = await import("supertest"));
  const { makeToken } = await import("../src/auth.js");
  token = makeToken({ id: 1, name: "Test" });
  secondUserToken = makeToken({ id: 2, name: "Second" });
});

test("protected readings reject unauthenticated requests", async () => {
  const response = await request(app).get("/api/readings");
  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Please log in.");
  assert.equal(response.body.code, "AUTH_REQUIRED");
  assert.equal(response.body.requestId, response.headers["x-request-id"]);
});

test("registration validates required fields before database access", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ name: "", email: "bad", password: "short" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /name/);
});

test("reading validation responds before any database query", async () => {
  const response = await request(app)
    .post("/api/readings")
    .set("Authorization", `Bearer ${token}`)
    .send({ date: "2026-01-01", slot: "morning", value: 39 });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Value must be between 40 and 600 mg/dl.");
});

test("reports reject malformed dates without querying the database", async () => {
  const response = await request(app)
    .get("/api/readings/reports?date=not-a-date")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Please select a valid date.");
});

test("malformed JSON gets a safe client error instead of a server error", async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send('{"email":');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_JSON");
  assert.equal(response.body.error, "Request body must be valid JSON.");
});

test("OTP throttling is scoped to both account and source IP", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request(app)
      .post("/api/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "invalid" });
    assert.equal(response.status, 400);
  }

  const otherAccount = await request(app)
    .post("/api/otp/request")
    .set("Authorization", `Bearer ${secondUserToken}`)
    .send({ phone: "invalid" });
  assert.equal(otherAccount.status, 400);

  const limited = await request(app)
    .post("/api/otp/request")
    .set("Authorization", `Bearer ${token}`)
    .send({ phone: "invalid" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RATE_LIMITED");
});
```

### `server/tests/config.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/sweety",
  JWT_SECRET: "a-long-enough-development-secret-that-is-not-real",
};

test("loads safe local defaults and leaves SMS disabled", () => {
  const config = loadConfig(valid);
  assert.equal(config.port, 4000);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.clientOrigin, "http://localhost:5173");
  assert.equal(config.smsEnabled, false);
});

test("fails fast for missing secrets and partial Twilio configuration", () => {
  assert.throws(
    () => loadConfig({ ...valid, JWT_SECRET: "short" }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => loadConfig({ ...valid, TWILIO_ACCOUNT_SID: "configured" }),
    /all three Twilio variables/,
  );
  assert.throws(
    () => loadConfig({ ...valid, CLIENT_ORIGIN: "https://example.com/app" }),
    /exact http or https origin/,
  );
});
```

### `server/tests/database.integration.test.js`

```js
import "dotenv/config";
import crypto from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

const databaseUrl = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

let app;
let request;
let pool;
let userA;
let userB;
let tokenA;
let tokenB;
const emailPrefix = `sweety-test-${crypto.randomUUID()}`;

before(async () => {
  if (!databaseUrl) return;
  ({ default: app } = await import("../src/server.js"));
  ({ default: request } = await import("supertest"));
  ({ pool } = await import("../src/db.js"));
  const { makeToken } = await import("../src/auth.js");
  const a = await pool.query(
    "INSERT INTO users(name,email,password_hash) VALUES('Integration A',$1,'test') RETURNING id,name",
    [`${emailPrefix}-a@example.invalid`],
  );
  const b = await pool.query(
    "INSERT INTO users(name,email,password_hash) VALUES('Integration B',$1,'test') RETURNING id,name",
    [`${emailPrefix}-b@example.invalid`],
  );
  userA = a.rows[0];
  userB = b.rows[0];
  tokenA = makeToken(userA);
  tokenB = makeToken(userB);
});

after(async () => {
  if (!databaseUrl || !pool) return;
  await pool.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [
    [userA?.id, userB?.id].filter(Boolean),
  ]);
  await pool.end();
});

test(
  "database-backed readings enforce concurrency and account ownership",
  {
    skip: !databaseUrl && "Set TEST_DATABASE_URL and run npm run migrate first",
  },
  async () => {
    const date = new Date().toISOString().slice(0, 10);
    const slots = ["morning", "after_breakfast", "after_lunch", "after_dinner"];
    const attempts = await Promise.all(
      slots.flatMap((slot, index) =>
        [0, 1].map(() =>
          request(app)
            .post("/api/readings")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ date, slot, value: 100 + index * 10 }),
        ),
      ),
    );

    assert.equal(
      attempts.filter((response) => response.status === 201).length,
      4,
    );
    assert.ok(
      attempts.every((response) => [201, 409].includes(response.status)),
    );

    const [listA, listB, report] = await Promise.all([
      request(app)
        .get("/api/readings")
        .set("Authorization", `Bearer ${tokenA}`),
      request(app)
        .get("/api/readings")
        .set("Authorization", `Bearer ${tokenB}`),
      request(app)
        .get(`/api/readings/reports?date=${date}`)
        .set("Authorization", `Bearer ${tokenA}`),
    ]);
    assert.equal(listA.body.length, 4);
    assert.equal(listB.body.length, 0);
    assert.equal(report.body.daily.count, 4);
    assert.equal(report.body.daily.average, 115);

    const hidden = await request(app)
      .delete(`/api/readings/${listA.body[0].id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    assert.equal(hidden.status, 404);

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const oldDate = yesterday.toISOString().slice(0, 10);
    const prior = await request(app)
      .post("/api/readings")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: oldDate, slot: "morning", value: 90 });
    assert.equal(prior.status, 201);
    const moveIntoFullDay = await request(app)
      .put(`/api/readings/${prior.body.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date, slot: "morning", value: 95 });
    assert.equal(moveIntoFullDay.status, 409);
    assert.equal(moveIntoFullDay.body.code, "DAILY_LIMIT_REACHED");
  },
);
```

### `server/tests/readingRules.test.js`

```js
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
```

### `client/package.json`

```json
{
  "name": "sweety-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.7.0",
    "vite": "^6.3.5",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {}
}
```

### `client/.env.example`

```dotenv
VITE_API_URL=http://localhost:4000/api

```

### `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <meta name="theme-color" content="#fffaf8" />
    <title>Sweety — Glucose tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### `client/src/main.jsx`

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

### `client/src/App.jsx`

```jsx
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const SLOTS = [
  ["morning", "Morning (fasting)"],
  ["after_breakfast", "After breakfast"],
  ["after_lunch", "After lunch"],
  ["after_dinner", "After dinner"],
];
const GOALS = [
  ["build_consistency", "Build a steady routine"],
  ["understand_patterns", "Notice my patterns"],
  ["share_with_clinician", "Keep a record to discuss with my care team"],
];
const utcToday = () => new Date().toISOString().slice(0, 10);
async function api(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}
const dateLabel = (s) =>
  new Date(`${s}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sweety-session"));
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [profile, setProfile] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [goal, setGoal] = useState("build_consistency");
  const [preferredSlot, setPreferredSlot] = useState("morning");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [date, setDate] = useState(utcToday());
  const [readings, setReadings] = useState([]);
  const [report, setReport] = useState(null);
  const [entry, setEntry] = useState({
    date: utcToday(),
    slot: "morning",
    value: "",
  });
  const [editing, setEditing] = useState(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadProfile(token, signal) {
    const me = await api("/me", token, { signal });
    setProfile(me);
    setGoal(me.tracking_goal || "build_consistency");
    setPreferredSlot(me.preferred_slot || "morning");
    setReminderEnabled(Boolean(me.reminder_enabled));
    setPhoneVerified(Boolean(me.phone_verified_at));
    setPhone(me.phone || "");
    if (!me.tracking_goal) setOnboarding(true);
  }
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    loadProfile(session.token, controller.signal).catch((e) => {
      if (!controller.signal.aborted) {
        setError(e.message);
        if (/expired|invalid/i.test(e.message)) logout();
      }
    });
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    Promise.all([
      api("/readings", session.token, { signal: controller.signal }),
      api(`/readings/reports?date=${encodeURIComponent(date)}`, session.token, {
        signal: controller.signal,
      }),
    ])
      .then(([items, r]) => {
        setReadings(items);
        setReport(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [date, session?.token]);

  async function submitAuth(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api(`/auth/${mode}`, null, {
        method: "POST",
        body: JSON.stringify(auth),
      });
      localStorage.setItem("sweety-session", JSON.stringify(result));
      setSession(result);
      setAuth({ name: "", email: "", password: "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveOnboarding(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const me = await api("/me", session.token, {
        method: "PATCH",
        body: JSON.stringify({ goal, preferredSlot, reminderEnabled }),
      });
      setProfile(me);
      setOnboarding(false);
      setNotice("Your preferences are saved. You can update them anytime.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveReading(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const selectedDate = entry.date;
      const body = JSON.stringify(entry);
      if (editing)
        await api(`/readings/${editing}`, session.token, {
          method: "PUT",
          body,
        });
      else await api("/readings", session.token, { method: "POST", body });
      setEditing(null);
      setEntry({ date: selectedDate, slot: "morning", value: "" });
      setDate(selectedDate);
      const [items, r] = await Promise.all([
        api("/readings", session.token),
        api(
          `/readings/reports?date=${encodeURIComponent(selectedDate)}`,
          session.token,
        ),
      ]);
      setReadings(items);
      setReport(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    if (!window.confirm("Delete this reading?")) return;
    try {
      await api(`/readings/${id}`, session.token, { method: "DELETE" });
      const [items, r] = await Promise.all([
        api("/readings", session.token),
        api(
          `/readings/reports?date=${encodeURIComponent(date)}`,
          session.token,
        ),
      ]);
      setReadings(items);
      setReport(r);
    } catch (e) {
      setError(e.message);
    }
  }
  function logout() {
    localStorage.removeItem("sweety-session");
    setSession(null);
    setProfile(null);
    setReadings([]);
    setReport(null);
    setOnboarding(false);
    setError("");
    setNotice("");
  }
  async function requestOtp(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api("/otp/request", session.token, {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setOtpSent(true);
      setNotice(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyOtp(value = code) {
    setError("");
    setBusy(true);
    try {
      await api("/otp/verify", session.token, {
        method: "POST",
        body: JSON.stringify({ phone, code: value }),
      });
      setPhoneVerified(true);
      setOtpSent(false);
      setNotice("Phone number verified.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !otpSent ||
      !session ||
      !("OTPCredential" in window) ||
      !window.isSecureContext
    )
      return;
    const controller = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        if (credential?.code) {
          setCode(credential.code);
          verifyOtp(credential.code);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [otpSent, session]);

  if (!session)
    return (
      <main className="auth-wrap">
        <section className="auth-card enter">
          <a className="brand" href="#home">
            <span className="brand-heart">♥</span>Sweety
          </a>
          <p className="eyebrow">A GENTLER WAY TO KEEP TRACK</p>
          <h1>
            {mode === "login"
              ? "Welcome back"
              : "Your wellness, one day at a time"}
          </h1>
          <p className="muted">
            A simple place to record your glucose readings and view your
            patterns.
          </p>
          <form className="form-stack" onSubmit={submitAuth}>
            {mode === "register" && (
              <label>
                Name
                <input
                  autoComplete="name"
                  maxLength="100"
                  required
                  value={auth.name}
                  onChange={(e) => setAuth({ ...auth, name: e.target.value })}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={auth.email}
                onChange={(e) => setAuth({ ...auth, email: e.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength="8"
                maxLength="72"
                required
                value={auth.password}
                onChange={(e) => setAuth({ ...auth, password: e.target.value })}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>
          <p className="switch">
            {mode === "login" ? "New to Sweety?" : "Already have an account?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "register" : "login");
              }}
            >
              {" "}
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        </section>
      </main>
    );

  if (onboarding)
    return (
      <main className="onboard-wrap">
        <section className="onboard-card enter">
          <div className="brand">
            <span className="brand-heart">♥</span>Sweety
          </div>
          <div className="progress">
            <span />
          </div>
          <p className="eyebrow">A FEW THINGS ABOUT YOU</p>
          <h1>Make Sweety feel like yours.</h1>
          <p className="muted">
            These preferences help shape your tracking experience. You can skip
            them or change them later.
          </p>
          <form onSubmit={saveOnboarding} className="form-stack">
            <fieldset>
              <legend>What would you like help with?</legend>
              {GOALS.map(([value, label]) => (
                <label
                  className={`choice ${goal === value ? "selected" : ""}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="goal"
                    value={value}
                    checked={goal === value}
                    onChange={() => setGoal(value)}
                  />
                  <span className="radio-dot" />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <label>
              When do you usually like to log a reading?
              <select
                value={preferredSlot}
                onChange={(e) => setPreferredSlot(e.target.value)}
              >
                {SLOTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-row">
              <span>
                <b>Reminder preference</b>
                <small>
                  This saves your preference only. Sweety does not send
                  reminders yet.
                </small>
              </span>
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
              />
            </label>
            <div className="divider" />
            <div>
              <p className="otp-title">Optional: verify your phone</p>
              <p className="hint">
                Useful for confirming your number. Email and password remain
                your sign-in method.
              </p>
              {phoneVerified ? (
                <p className="verified">✓ Phone verified</p>
              ) : (
                <>
                  <div className="phone-row">
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+1 415 555 2671"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={requestOtp}
                    >
                      {otpSent ? "Send again" : "Text me a code"}
                    </button>
                  </div>
                  {otpSent && (
                    <div className="phone-row otp-row">
                      <input
                        aria-label="Six-digit verification code"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength="6"
                        placeholder="6-digit code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (code.length === 6) verifyOtp();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || code.length !== 6}
                        onClick={() => verifyOtp()}
                      >
                        Verify
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => saveOnboarding({ preventDefault() {} })}
              >
                Skip for now
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Finish setup"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );

  const dayRows = report?.daily?.readings || [];
  const cards = [
    ["Today", report?.daily],
    ["Month to date", report?.monthToDate],
    ["Previous month", report?.previousMonth],
  ];
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home">
          <span className="brand-heart">♥</span>Sweety
        </a>
        <div className="top-actions">
          <span>Hi, {profile?.name}</span>
          <button className="quiet-button" onClick={() => setOnboarding(true)}>
            Preferences
          </button>
          <button className="quiet-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">YOUR GLUCOSE JOURNAL</p>
          <h1>A little care, every day.</h1>
          <p className="muted">Your readings, organized in one calm place.</p>
        </div>
        <div className="flower" aria-hidden="true">
          ✿
        </div>
      </section>
      {error && (
        <div className="error page-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="success page-error" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <section className="summary-grid" aria-label="Reports">
        {cards.map(([title, item]) => (
          <article className="card summary enter" key={title}>
            <p className="card-label">{title}</p>
            <p className="date-range">
              {item
                ? `${dateLabel(item.from)}${item.from !== item.to ? ` – ${dateLabel(item.to)}` : ""}`
                : "Select a date"}
            </p>
            {item?.count ? (
              <>
                <div className="average">
                  {item.average}
                  <small>mg/dL average</small>
                </div>
                <div className="high-low">
                  <span>
                    Highest <b>{item.highest}</b>
                  </span>
                  <span>
                    Lowest <b>{item.lowest}</b>
                  </span>
                </div>
                <p className="count">
                  {item.count} {item.count === 1 ? "reading" : "readings"}
                </p>
              </>
            ) : (
              <p className="empty-small">No readings for this period.</p>
            )}
          </article>
        ))}
      </section>
      <div className="work-grid">
        <section className="card form-card">
          <div className="card-heading">
            <div>
              <p className="card-label">DAILY LOG</p>
              <h2>{editing ? "Edit reading" : "Add a reading"}</h2>
            </div>
            <span className="badge-icon">＋</span>
          </div>
          <form className="form-stack" onSubmit={saveReading}>
            <label>
              Date
              <input
                type="date"
                max={utcToday()}
                required
                value={entry.date}
                onChange={(e) => setEntry({ ...entry, date: e.target.value })}
              />
            </label>
            <label>
              Time slot
              <select
                required
                value={entry.slot}
                onChange={(e) => setEntry({ ...entry, slot: e.target.value })}
              >
                {SLOTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Glucose value <small className="unit">mg/dL</small>
              <input
                type="number"
                min="40"
                max="600"
                step="1"
                required
                placeholder="For example, 105"
                value={entry.value}
                onChange={(e) => setEntry({ ...entry, value: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Save reading"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    setEditing(null);
                    setEntry({ date, slot: "morning", value: "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <p className="hint">
            One reading per time slot, up to four each day.
          </p>
        </section>
        <section className="card history-card">
          <div className="card-heading">
            <div>
              <p className="card-label">READING HISTORY</p>
              <h2>Your readings</h2>
            </div>
            <label className="date-input">
              <span className="sr-only">Report date</span>
              <input
                type="date"
                max={utcToday()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          {dayRows.length ? (
            <div className="reading-list">
              {dayRows.map((r) => (
                <article className="reading" key={r.id}>
                  <span className="reading-marker" />
                  <div className="reading-name">
                    <b>
                      {SLOTS.find(([key]) => key === r.slot)?.[1] || r.slot}
                    </b>
                    <small>{dateLabel(r.date)}</small>
                  </div>
                  <strong>
                    {r.value}
                    <small> mg/dL</small>
                  </strong>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditing(r.id);
                        setEntry({
                          date: r.date,
                          slot: r.slot,
                          value: String(r.value),
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => remove(r.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span>♡</span>
              <b>No readings on this date</b>
              <p>Choose a date or add your first reading.</p>
            </div>
          )}
        </section>
      </div>
      <footer>
        Made for mindful tracking <span>·</span> Your health data belongs to you
      </footer>
    </main>
  );
}
```

### `client/src/styles.css`

```css
@import url("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap");
:root {
  font-family: "DM Sans", sans-serif;
  color: #39363a;
  background: #fffaf8;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  font-optical-sizing: auto;
  font-weight: 400;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  min-width: 320px;
}
button,
input,
select {
  font: inherit;
}
button {
  cursor: pointer;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid #df9cad;
  outline-offset: 2px;
}
.app-shell {
  max-width: 1120px;
  margin: auto;
  padding: 0 28px;
}
.topbar {
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0e9e5;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #38343a;
  text-decoration: none;
  font:
    800 21px Manrope,
    sans-serif;
}
.brand-heart {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border-radius: 13px;
  color: #c66783;
  background: #f8e8ed;
  font-size: 17px;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 15px;
  color: #81777d;
  font-size: 13px;
}
.quiet-button,
.secondary {
  background: white;
  border: 1px solid #eae0dd;
  border-radius: 10px;
  padding: 9px 13px;
  color: #625a5e;
  font-size: 12px;
  font-weight: 600;
}
.quiet-button:hover,
.secondary:hover {
  border-color: #d79aaa;
  color: #a6506b;
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 38px 0 26px;
}
.eyebrow,
.card-label {
  margin: 0;
  color: #b47988;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.hero h1,
.auth-card h1,
.onboard-card h1 {
  font:
    700 clamp(26px, 4vw, 36px) Manrope,
    sans-serif;
  letter-spacing: -1.2px;
  margin: 8px 0;
}
.muted {
  color: #90868b;
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}
.flower {
  font-size: 52px;
  color: #d9a7b6;
  transform: rotate(-10deg);
  padding: 0 30px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}
.card {
  background: #fff;
  border: 1px solid #efe8e4;
  border-radius: 17px;
  box-shadow: 0 6px 24px #55321b08;
}
.summary {
  padding: 19px 21px;
  min-height: 171px;
}
.date-range {
  font-size: 11px;
  color: #a0979b;
  margin: 8px 0 15px;
}
.average {
  font: 700 30px Manrope;
  color: #484148;
}
.average small {
  font: 400 11px "DM Sans";
  color: #9d9498;
  margin-left: 7px;
}
.high-low {
  display: flex;
  gap: 18px;
  margin-top: 10px;
  color: #a0979b;
  font-size: 11px;
}
.high-low b {
  color: #655d62;
  margin-left: 4px;
}
.count,
.empty-small {
  color: #a0979b;
  font-size: 11px;
  margin: 10px 0 0;
}
.empty-small {
  margin-top: 26px;
}
.work-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.4fr);
  gap: 15px;
  margin-top: 17px;
}
.form-card,
.history-card {
  padding: 22px;
}
.card-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.card-heading h2 {
  font: 700 19px Manrope;
  letter-spacing: -0.4px;
  margin: 5px 0 0;
}
.badge-icon {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border-radius: 12px;
  color: #bd6c85;
  background: #fbf0f3;
  font-size: 20px;
}
.form-stack {
  display: grid;
  gap: 14px;
}
.form-stack > label {
  display: grid;
  gap: 7px;
  color: #696267;
  font-size: 12px;
  font-weight: 600;
}
.form-stack input:not([type="radio"]):not([type="checkbox"]),
.form-stack select,
.date-input input,
.phone-row input {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #e9e0dc;
  border-radius: 10px;
  background: white;
  color: #454047;
  outline: none;
}
.form-stack input:focus,
.form-stack select:focus,
.date-input input:focus,
.phone-row input:focus {
  border-color: #ce8b9e;
  box-shadow: 0 0 0 3px #f8edf0;
}
.unit {
  font-weight: 400;
  color: #a0979b;
  margin-left: 4px;
}
.primary {
  border: 0;
  border-radius: 10px;
  padding: 12px 16px;
  background: #c76f88;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4px 10px #c86e8826;
}
.primary:hover {
  background: #b95d78;
}
.primary:disabled,
.secondary:disabled {
  opacity: 0.65;
  cursor: wait;
}
.form-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.hint {
  font-size: 11px;
  color: #a69ca0;
  margin: 13px 0 0;
}
.date-input input {
  padding: 8px;
  font-size: 11px;
}
.reading-list {
  display: grid;
}
.reading {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px 0;
  border-top: 1px solid #f2ebe8;
}
.reading-marker {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 50%;
  background: #d1879e;
}
.reading-name {
  display: grid;
  gap: 4px;
  flex: 1;
}
.reading-name b {
  font-size: 12px;
  font-weight: 600;
}
.reading-name small {
  font-size: 10px;
  color: #a49a9e;
}
.reading > strong {
  font: 700 17px Manrope;
  white-space: nowrap;
  color: #514950;
}
.reading > strong small {
  font: 400 10px "DM Sans";
  color: #a0979b;
}
.row-actions {
  display: flex;
  gap: 9px;
}
.text-button {
  border: 0;
  padding: 4px 0;
  background: transparent;
  color: #b45d78;
  font-size: 11px;
  font-weight: 600;
}
.danger {
  color: #a56568;
}
.empty-state {
  min-height: 175px;
  border-top: 1px solid #f2ebe8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #90868b;
}
.empty-state span {
  font-size: 26px;
  color: #d9a8b7;
  margin-bottom: 7px;
}
.empty-state b {
  font: 600 13px Manrope;
}
.empty-state p {
  font-size: 11px;
  color: #aaa0a4;
}
.error,
.success {
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 12px;
}
.error {
  border: 1px solid #f4d3d0;
  background: #fff0ef;
  color: #9c4445;
}
.success {
  border: 1px solid #d5eadb;
  background: #f2fbf4;
  color: #437a50;
}
.page-error {
  display: flex;
  justify-content: space-between;
  margin: 0 0 12px;
}
.page-error button {
  border: 0;
  background: none;
  color: inherit;
  font-size: 17px;
}
footer {
  text-align: center;
  padding: 26px 0 30px;
  color: #aaa0a4;
  font-size: 10px;
}
footer span {
  padding: 0 5px;
  color: #d9a8b7;
}
.auth-wrap,
.onboard-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at 9% 10%, #f8e8ec 0, transparent 34%), #fffaf8;
}
.auth-card,
.onboard-card {
  width: min(100%, 430px);
  padding: 34px;
  background: white;
  border: 1px solid #efe8e4;
  border-radius: 22px;
  box-shadow: 0 14px 48px #56311b0c;
}
.auth-card .brand,
.onboard-card .brand {
  margin-bottom: 30px;
}
.auth-card h1,
.onboard-card h1 {
  font-size: 27px;
  margin: 9px 0;
}
.auth-card > .muted,
.onboard-card > .muted {
  margin-bottom: 23px;
}
.form-stack label {
  font-size: 12px;
}
.switch {
  text-align: center;
  margin: 21px 0 0;
  font-size: 12px;
  color: #90868b;
}
.progress {
  height: 4px;
  background: #f4ebed;
  border-radius: 9px;
  margin: -9px 0 24px;
}
.progress span {
  display: block;
  width: 66%;
  height: 100%;
  border-radius: 9px;
  background: #cf879c;
}
.onboard-card {
  width: min(100%, 540px);
}
fieldset {
  display: grid;
  gap: 8px;
  border: 0;
  padding: 0;
  margin: 0 0 2px;
}
legend {
  font-size: 12px;
  font-weight: 600;
  color: #696267;
  margin-bottom: 9px;
}
.choice {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  gap: 11px !important;
  padding: 11px 12px;
  border: 1px solid #eee5e2;
  border-radius: 11px;
  cursor: pointer;
}
.choice.selected {
  border-color: #d79aaa;
  background: #fff8fa;
}
.choice input {
  position: absolute;
  opacity: 0;
}
.radio-dot {
  width: 15px;
  height: 15px;
  border: 1px solid #d2c5c5;
  border-radius: 50%;
  flex: none;
}
.choice.selected .radio-dot {
  border: 5px solid #c76f88;
}
.toggle-row {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid #f4edeb;
  border-bottom: 1px solid #f4edeb;
}
.toggle-row span {
  display: grid;
  gap: 4px;
}
.toggle-row b {
  font-size: 12px;
}
.toggle-row small {
  font-weight: 400;
  color: #999094;
  line-height: 1.4;
}
.toggle-row input {
  accent-color: #c76f88;
  width: 18px;
  height: 18px;
}
.divider {
  height: 1px;
  background: #f2eae7;
  margin: 2px 0;
}
.otp-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
}
.onboard-card .hint {
  margin: 0 0 10px;
  line-height: 1.5;
}
.phone-row {
  display: flex;
  gap: 8px;
}
.phone-row input {
  min-width: 0;
  font-size: 12px;
}
.otp-row {
  margin-top: 8px;
}
.verified {
  font-size: 12px;
  color: #438051;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.enter {
  animation: arrive 0.45s ease-out both;
}
.summary:nth-child(2) {
  animation-delay: 0.06s;
}
.summary:nth-child(3) {
  animation-delay: 0.12s;
}
.primary,
.secondary,
.quiet-button {
  transition:
    background 0.18s,
    border-color 0.18s,
    transform 0.18s;
}
.primary:not(:disabled):hover,
.secondary:not(:disabled):hover,
.quiet-button:hover {
  transform: translateY(-1px);
}
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(9px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
@media (max-width: 760px) {
  .app-shell {
    padding: 0 17px;
  }
  .summary-grid {
    grid-template-columns: 1fr;
    gap: 9px;
  }
  .summary {
    min-height: 0;
    padding: 15px 18px;
  }
  .work-grid {
    grid-template-columns: 1fr;
  }
  .hero {
    padding: 29px 0 20px;
  }
  .flower {
    padding: 0;
    font-size: 40px;
  }
  .topbar {
    height: 66px;
  }
  .top-actions {
    gap: 8px;
    font-size: 11px;
  }
  .top-actions .quiet-button {
    padding: 8px;
    font-size: 10px;
  }
  .form-card,
  .history-card {
    padding: 18px;
  }
}
@media (max-width: 400px) {
  .reading {
    flex-wrap: wrap;
  }
  .reading-name {
    min-width: 125px;
  }
  .row-actions {
    margin-left: 20px;
  }
  .auth-card,
  .onboard-card {
    padding: 26px 21px;
  }
  .top-actions > span {
    display: none;
  }
}
```

### `.gitignore`

```text
node_modules/
dist/
.env
coverage/
.DS_Store

```
