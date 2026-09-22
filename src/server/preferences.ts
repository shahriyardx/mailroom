import "server-only";
import { db } from "@/db";
import { preference } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * What the app looks like, per person.
 *
 * Kept in the database rather than the browser so the choices are the same on
 * a phone as on a desktop. Everything has a default, so a row is only written
 * once somebody changes something.
 */
export interface Appearance {
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  readingLayout: "split" | "stacked";
  navCollapsed: boolean;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "dark",
  density: "comfortable",
  readingLayout: "split",
  navCollapsed: false,
};

const THEMES = ["system", "light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;
const LAYOUTS = ["split", "stacked"] as const;

/** Anything unrecognised — an older row, a hand-edited one — reads as default. */
function one<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function getAppearance(userId: string): Promise<Appearance> {
  const [row] = await db.select().from(preference).where(eq(preference.userId, userId));
  if (!row) return APPEARANCE_DEFAULTS;

  return {
    theme: one(THEMES, row.theme, APPEARANCE_DEFAULTS.theme),
    density: one(DENSITIES, row.density, APPEARANCE_DEFAULTS.density),
    readingLayout: one(LAYOUTS, row.readingLayout, APPEARANCE_DEFAULTS.readingLayout),
    navCollapsed: row.navCollapsed,
  };
}

/** Writes only what was named, leaving the rest of the row as it was. */
export async function saveAppearance(userId: string, patch: Partial<Appearance>) {
  const current = await getAppearance(userId);
  const next: Appearance = {
    theme: one(THEMES, patch.theme ?? current.theme, current.theme),
    density: one(DENSITIES, patch.density ?? current.density, current.density),
    readingLayout: one(
      LAYOUTS,
      patch.readingLayout ?? current.readingLayout,
      current.readingLayout,
    ),
    navCollapsed: patch.navCollapsed ?? current.navCollapsed,
  };

  await db
    .insert(preference)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preference.userId,
      set: { ...next, updatedAt: new Date() },
    });

  return next;
}
