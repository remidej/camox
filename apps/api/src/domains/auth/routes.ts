import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, oneTimeToken, organization } from "better-auth/plugins";
import { Hono } from "hono";
import slugify from "slugify";

import type { Database } from "../../db";
import {
  user,
  session,
  account,
  verification,
  organizationTable,
  member,
  invitation,
} from "../../schema";
import type { AppEnv, Bindings } from "../../types";
import { crossDomain } from "./cross-domain";
import {
  sendOrganizationInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";

// --- Auth Factory ---

const authSchema = {
  user,
  session,
  account,
  verification,
  organization: organizationTable,
  member,
  invitation,
};

function generateSlug(name: string): string {
  const base = slugify(name, { lower: true, strict: true });
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${base}-${suffix}`;
}

export function getCookieDomain(siteUrl: string): string | undefined {
  try {
    const siteHost = new URL(siteUrl).hostname;
    // Worktrees share cookies across ports, never across checkout hostnames.
    if (siteHost === "localhost" || siteHost.endsWith(".localhost")) return undefined;
    if (siteHost === "127.0.0.1" || siteHost === "[::1]") return undefined;
    if (siteHost === "camox.dev" || siteHost.endsWith(".camox.dev")) return ".camox.dev";
    return `.${siteHost}`;
  } catch {
    return undefined;
  }
}

export function createAuth(
  db: Database,
  env: Bindings,
  baseURL: string,
  waitUntil?: (promise: Promise<unknown>) => void,
) {
  // Camox services may use sibling hosts in production. Localhost works
  // without an explicit domain.
  const cookieDomain = getCookieDomain(baseURL);

  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(env, user.email, url);
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(env, user.email, url);
      },
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // refresh session expiry daily
    },
    // Accept requests from any origin — Camox sites run on arbitrary customer domains
    trustedOrigins: ["*"],
    advanced: {
      ...(waitUntil
        ? {
            backgroundTasks: {
              handler: waitUntil,
            },
          }
        : {}),
      crossSubDomainCookies: cookieDomain
        ? {
            enabled: true,
            domain: cookieDomain,
          }
        : {
            enabled: false,
          },
    },
    plugins: [
      organization({
        sendInvitationEmail: async ({ email, id, inviter, organization }) => {
          const url = new URL("/accept-invitation", env.DASHBOARD_URL);
          url.searchParams.set("invitationId", id);

          await sendOrganizationInvitationEmail(env, {
            to: email,
            organizationName: organization.name,
            inviterName: inviter.user.name,
            url: url.toString(),
          });
        },
      }),
      crossDomain({ siteUrl: env.DASHBOARD_URL }),
      oneTimeToken(),
      bearer(),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const orgName = `${user.name}'s team`;
            const slug = generateSlug(orgName);
            await auth.api.createOrganization({
              body: {
                name: orgName,
                slug,
                userId: user.id,
              },
            });
          },
        },
      },
    },
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;

// --- Routes ---

export const authRoutes = new Hono<AppEnv>().on(["POST", "GET"], "/*", async (c) => {
  const url = new URL(c.req.url);
  const auth = createAuth(c.var.db, c.env, url.origin, (promise) =>
    c.executionCtx.waitUntil(promise),
  );
  return auth.handler(c.req.raw);
});
