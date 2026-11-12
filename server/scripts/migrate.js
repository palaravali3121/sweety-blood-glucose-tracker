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
