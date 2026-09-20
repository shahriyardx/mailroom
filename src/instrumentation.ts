/**
 * Runs pending database migrations once, as the server boots.
 *
 * Keeping this in app code means the migrator is traced into the standalone
 * build, so the runtime image needs nothing extra. Drizzle records what it has
 * applied, so a restart is a no-op.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_MIGRATIONS_ON_BOOT === "false") return;

  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("migrations skipped: DATABASE_URL is not set");
    return;
  }

  // A dedicated single connection, closed as soon as migrating is done.
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("migrations up to date");
  } catch (error) {
    console.error("migrations failed", error);
    throw error;
  } finally {
    await sql.end();
  }
}
