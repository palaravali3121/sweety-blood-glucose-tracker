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
