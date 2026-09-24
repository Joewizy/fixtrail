import { readFile } from "node:fs/promises";
import { Client } from "pg";

const connectionString =
  process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("Set DIRECT_DATABASE_URL or DATABASE_URL before migrating.");
const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query(
    await readFile(
      new URL(
        "../supabase/migrations/202609240001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  console.log("FixTrail schema is ready.");
} catch {
  console.error(
    "Database migration failed. Check the connection, credentials, and database permissions.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
