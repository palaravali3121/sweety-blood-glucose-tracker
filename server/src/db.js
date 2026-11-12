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
