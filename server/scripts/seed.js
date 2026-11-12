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
