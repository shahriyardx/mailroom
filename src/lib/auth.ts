import { db, schema } from "@/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { count } from "drizzle-orm";

/**
 * This is a single-operator dashboard: the first person to sign in becomes the
 * owner, and after that no new accounts can be created. Anyone else reaching
 * the sign-in page gets turned away rather than silently given an inbox.
 */
async function registrationIsOpen() {
  const [row] = await db.select({ total: count() }).from(schema.user);
  return (row?.total ?? 0) === 0;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  // GitHub is the only way in. There is no password to leak or reset.
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      // GitHub verifies the email it reports, so an existing owner signing in
      // with GitHub links to their account instead of being refused.
      trustedProviders: ["github"],
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (await registrationIsOpen()) return { data: user };
          throw new APIError("FORBIDDEN", {
            message: "This dashboard already has an owner. New accounts are closed.",
          });
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    database: { generateId: () => crypto.randomUUID() },
  },

  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
