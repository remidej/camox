import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { z } from "zod";

import { isLocalCallback } from "./studio-hosts";

export function resolveCallbackURL(
  callbackURL: string | undefined,
  siteUrl: string,
  requestOrigin?: string,
) {
  if (!callbackURL?.startsWith("/")) return callbackURL;

  const baseURL = requestOrigin || siteUrl;
  if (!baseURL) return callbackURL;

  return new URL(callbackURL, baseURL).toString();
}

/** How long a one-time token waits to be exchanged. */
const ONE_TIME_TOKEN_TTL_MS = 3 * 60 * 1000;

const STUDIO_SESSION_REFUSED = "A studio session can't sign anything else in";

const oneTimeTokenIdentifier = (token: string) => `one-time-token:${token}`;

/** What a one-time token exchanges for: a new session of the minting session's user. */
const grantSchema = z.object({ sessionToken: z.string(), studio: z.boolean() });
type Grant = z.infer<typeof grantSchema>;

function parseGrant(value: string): Grant | null {
  try {
    return grantSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * Whether a session is the studio's on a site, whose scripts can read it. It mints no one-time
 * tokens and reads no other session, so revoking it signs the user out of that site alone.
 */
function isStudioSession(session: object | undefined) {
  return Boolean(session && "studio" in session && session.studio);
}

/**
 * An endpoint that hands the signed-in user's `callback` a one-time token, when `isAllowed` accepts
 * it, as the callback URL with `?ott=`. `studio` makes the token exchange for a studio session.
 */
function authorizeCallback<Path extends string>(
  path: Path,
  {
    isAllowed,
    studio,
  }: { isAllowed: (callback: URL, userId: string) => Promise<boolean>; studio: boolean },
) {
  return createAuthEndpoint(
    path,
    {
      method: "POST",
      body: z.object({ callback: z.string() }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const { session, user } = ctx.context.session;
      if (isStudioSession(session)) {
        throw new APIError("FORBIDDEN", { message: STUDIO_SESSION_REFUSED });
      }
      const callback = URL.parse(ctx.body.callback);
      if (!callback || !(await isAllowed(callback, user.id))) {
        throw new APIError("FORBIDDEN", { message: "Camox can't sign in at this callback" });
      }
      const token = generateRandomString(32);
      await ctx.context.internalAdapter.createVerificationValue({
        value: JSON.stringify({ sessionToken: session.token, studio } satisfies Grant),
        identifier: oneTimeTokenIdentifier(token),
        expiresAt: new Date(Date.now() + ONE_TIME_TOKEN_TTL_MS),
      });
      callback.searchParams.set("ott", token);
      return ctx.json({ url: callback.toString() });
    },
  );
}

/**
 * Cross-domain authentication plugin for better-auth.
 *
 * When the API server and frontend live on completely different domains,
 * browsers won't send or accept cookies across origins. This plugin works
 * around that by:
 *
 * 1. Reading cookies from a custom `Better-Auth-Cookie` request header
 *    (sent by the client plugin) and injecting them as real cookies.
 * 2. Moving `set-cookie` response headers into a custom
 *    `Set-Better-Auth-Cookie` header so the client can persist them in
 *    localStorage.
 * 3. Rewriting relative callback URLs to absolute URLs using `siteUrl`.
 * 4. Handing one-time tokens only to callbacks the API checks: the studio's
 *    on a host `isStudioHost` accepts, or the CLI's and dev servers' on this
 *    computer. Each token exchanges for a new session of its own, so a site's
 *    session signs out and is revoked on its own, and a studio session, which
 *    the site's scripts can read, can't mint more.
 *
 * Adapted from `@convex-dev/better-auth/plugins/cross-domain`.
 */
export function crossDomain({
  siteUrl,
  isStudioHost,
}: {
  siteUrl: string;
  /** Whether the studio at this callback may get a session for this user. */
  isStudioHost: (callback: URL, userId: string) => Promise<boolean>;
}) {
  const getRequestOrigin = (ctx: { headers?: Headers; request?: Request }) => {
    return ctx.request?.headers.get("origin") ?? ctx.headers?.get("origin") ?? undefined;
  };

  const rewriteCallbackURL = (
    callbackURL: string | undefined,
    ctx: { headers?: Headers; request?: Request },
  ) => {
    return resolveCallbackURL(callbackURL, siteUrl, getRequestOrigin(ctx));
  };

  const isExpoNative = (ctx: { headers?: Headers }) => {
    return ctx.headers?.has("expo-origin");
  };

  // Annotated so the plugin's inferred type doesn't spell out better-auth's
  // internal middleware context, which declaration emit can't name.
  const hooks: BetterAuthPlugin["hooks"] = {
    before: [
      // Inject the `Better-Auth-Cookie` header as a real cookie header
      {
        matcher(ctx) {
          return (
            Boolean(
              ctx.request?.headers.has("better-auth-cookie") ||
              ctx.headers?.has("better-auth-cookie"),
            ) && !isExpoNative(ctx)
          );
        },
        handler: createAuthMiddleware(async (ctx) => {
          const existingHeaders = (ctx.request?.headers || ctx.headers) as Headers;
          const headers = new Headers(Object.fromEntries(existingHeaders?.entries()));
          if (headers.get("authorization")) return;
          const cookie = headers.get("better-auth-cookie");
          if (!cookie) return;
          // Must build the cookie header manually rather than using
          // `headers.append("cookie", cookie)` — on workerd, appending to
          // an existing cookie header produces a value that better-auth
          // can't parse, silently breaking session lookup whenever the
          // browser also sends its own cookies for this origin.
          const existingCookie = headers.get("cookie");
          headers.set("cookie", existingCookie ? `${existingCookie}; ${cookie}` : cookie);
          return { context: { headers } };
        }),
      },
      // Rewrite relative callbackURL on email-verification GET requests
      {
        matcher: (ctx) =>
          Boolean(
            ctx.method === "GET" && ctx.path?.startsWith("/verify-email") && !isExpoNative(ctx),
          ),
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.query?.callbackURL) {
            ctx.query.callbackURL = rewriteCallbackURL(ctx.query.callbackURL, ctx);
          }
          return { context: ctx };
        }),
      },
      // Rewrite relative callback URLs on POST requests
      {
        matcher: (ctx) => Boolean(ctx.method === "POST" && !isExpoNative(ctx)),
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.body?.callbackURL) {
            ctx.body.callbackURL = rewriteCallbackURL(ctx.body.callbackURL, ctx);
          }
          if (ctx.body?.newUserCallbackURL) {
            ctx.body.newUserCallbackURL = rewriteCallbackURL(ctx.body.newUserCallbackURL, ctx);
          }
          if (ctx.body?.errorCallbackURL) {
            ctx.body.errorCallbackURL = rewriteCallbackURL(ctx.body.errorCallbackURL, ctx);
          }
          return { context: ctx };
        }),
      },
    ],
    after: [
      // Move `set-cookie` → `Set-Better-Auth-Cookie` header
      {
        matcher(ctx) {
          return (
            Boolean(
              ctx.request?.headers.has("better-auth-cookie") ||
              ctx.headers?.has("better-auth-cookie"),
            ) && !isExpoNative(ctx)
          );
        },
        handler: createAuthMiddleware(async (ctx) => {
          const setCookie = ctx.context.responseHeaders?.get("set-cookie");
          if (!setCookie) return;
          ctx.context.responseHeaders?.delete("set-cookie");
          ctx.setHeader("Set-Better-Auth-Cookie", setCookie);
        }),
      },
      // A studio session's scripts could read the tokens of the user's other sessions, the
      // dashboard's among them, which would outlive revoking the studio's.
      {
        matcher: (ctx) => ctx.path === "/list-sessions",
        handler: createAuthMiddleware(async (ctx) => {
          if (isStudioSession((await getSessionFromCtx(ctx))?.session)) {
            throw new APIError("FORBIDDEN", { message: STUDIO_SESSION_REFUSED });
          }
        }),
      },
    ],
  };

  return {
    id: "cross-domain",
    init() {
      return {
        options: {
          trustedOrigins: [siteUrl],
        },
        context: {
          oauthConfig: {
            storeStateStrategy: "database",
            // We can't relay the state cookie across a 302 redirect from the
            // identity provider. The state token is still verified against the
            // database, so this only means we can't prevent an OAuth flow
            // started in one browser from completing in another.
            skipStateCookieCheck: true,
          },
        },
      };
    },
    hooks,
    schema: {
      session: {
        fields: {
          studio: { type: "boolean", required: false, input: false },
        },
      },
    },
    endpoints: {
      /**
       * What the dashboard's /studio-authorize page and `camox preview` call: the studio's callback
       * URL with a one-time token, when the signed-in user may use the studio on its host. The
       * token exchanges for a studio session.
       */
      authorizeStudio: authorizeCallback("/cross-domain/studio-authorize", {
        isAllowed: isStudioHost,
        studio: true,
      }),
      /**
       * What the dashboard's /cli-authorize and /dev-authorize pages call: a callback on this
       * computer, the CLI's or a dev server's, with a one-time token for a session of their own.
       */
      authorizeLocal: authorizeCallback("/cross-domain/local-authorize", {
        isAllowed: async (callback) => isLocalCallback(callback),
        studio: false,
      }),
      /**
       * Exchanges a one-time token for a new session of the token's user, rather than the session
       * that minted it: signing out where it lands leaves the dashboard signed in.
       */
      verifyOneTimeToken: createAuthEndpoint(
        "/one-time-token/verify",
        {
          method: "POST",
          body: z.object({ token: z.string() }),
        },
        async (ctx) => {
          const verification = await ctx.context.internalAdapter.consumeVerificationValue(
            oneTimeTokenIdentifier(ctx.body.token),
          );
          const grant = verification && parseGrant(verification.value);
          if (!grant) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          const mintingSession = await ctx.context.internalAdapter.findSession(grant.sessionToken);
          if (!mintingSession || mintingSession.session.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", { message: "Session expired" });
          }
          const session = await ctx.context.internalAdapter.createSession(
            mintingSession.user.id,
            false,
            grant.studio ? { studio: true } : undefined,
          );
          const signedIn = { session, user: mintingSession.user };
          await setSessionCookie(ctx, signedIn);
          return ctx.json(signedIn);
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
