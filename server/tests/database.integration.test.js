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
