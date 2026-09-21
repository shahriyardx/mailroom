import { db, schema } from "@/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";

/**
 * One company runs one instance. The first person to sign in creates it and
 * becomes its owner; everyone after that has to have been invited, so a
 * stranger who finds the sign-in page cannot give themselves an inbox.
 */
async function isFirstUser() {
  const [row] = await db.select({ total: count() }).from(schema.user);
  return (row?.total ?? 0) === 0;
}

/**
 * Whether an account may be created for this address, and on what evidence.
 *
 * Two things can vouch for someone. Opening the invitation link proves they
 * received the message: that moves the invitation to "accepting", and only
 * then may a password account be made. Signing in with GitHub proves the
 * address a different way, because the provider has verified it — so a
 * pending invitation is enough there.
 *
 * The distinction matters. A password sign-up asserts nothing about the
 * address it claims, so allowing one merely because that address had been
 * invited would let anyone who learned of an invitation take the seat.
 */
async function invitationAllows(email: string, emailIsProven: boolean) {
  const [row] = await db
    .select({ status: schema.invitation.status })
    .from(schema.invitation)
    .where(eq(schema.invitation.email, email.toLowerCase()))
    .limit(1);

  if (!row) return false;
  if (row.status === "accepting") return true;
  return emailIsProven && row.status === "pending";
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

  /**
   * The owner signs in with GitHub. People who are invited set a password
   * instead, because a company's staff should not each need a GitHub account
   * to read their own mail. Sign-up is closed either way: an account only
   * comes into being through an invitation link.
   */
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: true,
  },

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
          // A provider that verified the address sets this; the password form
          // cannot.
          const proven = (user as { emailVerified?: boolean }).emailVerified === true;
          if (await invitationAllows(user.email, proven)) return { data: user };
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
