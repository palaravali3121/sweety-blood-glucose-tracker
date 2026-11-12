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
