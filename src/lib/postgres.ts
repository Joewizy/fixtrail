import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const shared = globalThis as unknown as { fixtrailPool?: Pool };
export function pool() {
  if (!shared.fixtrailPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("Database is not configured. Set DATABASE_URL.");
    shared.fixtrailPool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
      query_timeout: 15000,
      allowExitOnIdle: true,
    });
    if (process.env.VERCEL) attachDatabasePool(shared.fixtrailPool);
    // Do not log connection details or credentials on idle-client errors.
    shared.fixtrailPool.on("error", () =>
      console.error("[FixTrail] Idle database connection failed"),
    );
  }
  return shared.fixtrailPool;
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  // Unnamed parameterized queries are compatible with Supabase's transaction pooler.
  return pool().query<T>(text, values);
}
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  if (shared.fixtrailPool) {
    await shared.fixtrailPool.end();
    delete shared.fixtrailPool;
  }
}
