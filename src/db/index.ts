import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

let instance: Database | undefined;

function connect(): Database {
  if (instance) return instance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // The connection pool is cached across HMR reloads so dev does not exhaust
  // Postgres. The Drizzle client is not: it is built from the schema, and
  // caching it there would keep serving a stale one after a table is added.
  const sql = globalForDb.sql ?? postgres(connectionString, { max: 10 });
  if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

  instance = drizzle(sql, { schema });
  return instance;
}

/**
 * Connects on first use rather than on import, so a production build can
 * collect route metadata without a database being reachable.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const client = connect();
    const value = Reflect.get(client, property);
    // Bind so a method called through the proxy still sees the real client
    // as `this` rather than the proxy.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { schema };
