import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { sql?: postgres.Sql; db?: Database };

function connect(): Database {
  if (globalForDb.db) return globalForDb.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Reuse the pool across HMR reloads so dev does not exhaust Postgres connections.
  const sql = globalForDb.sql ?? postgres(connectionString, { max: 10 });
  const instance = drizzle(sql, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.sql = sql;
    globalForDb.db = instance;
  }
  return instance;
}

/**
 * Connects on first use rather than on import, so a production build can
 * collect route metadata without a database being reachable.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(connect(), property, receiver);
  },
});

export { schema };
