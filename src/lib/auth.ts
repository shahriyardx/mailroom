import { db, schema } from "@/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { and, count, eq } from "drizzle-orm";

/**
 * One company runs one instance. The first person to sign in creates it and
 * becomes its owner; everyone after that has to have been invited, so a
 * stranger who finds the sign-in page cannot give themselves an inbox.
 */
async function isFirstUser() {
  const [row] = await db.select({ total: count() }).from(schema.user);
  return (row?.total ?? 0) === 0;
}

async function hasInvitation(email: string) {
  const [row] = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.email, email.toLowerCase()),
        eq(schema.invitation.status, "pending"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      team: schema.team,
      teamMember: schema.teamMember,
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
          if (await isFirstUser()) return { data: user };
          if (await hasInvitation(user.email)) return { data: user };
          throw new APIError("FORBIDDEN", {
            message: "This instance is private. Ask an administrator to invite your email address.",
          });
        },
        after: async (user) => {
          // Membership is what makes the mail visible, so it is granted here
          // rather than lazily on first read.
          const { provisionUser } = await import("@/server/provision");
          await provisionUser(user);
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

  plugins: [
    organization({
      // The instance belongs to one company, so nobody creates a second.
      allowUserToCreateOrganization: false,
      teams: { enabled: true },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
