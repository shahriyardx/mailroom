import "server-only";
import { db } from "@/db";
import { user } from "@/db/schema";
import { count } from "drizzle-orm";

/** True until the first account exists, after which sign-up is closed. */
export async function registrationOpen() {
  const [row] = await db.select({ total: count() }).from(user);
  return (row?.total ?? 0) === 0;
}
