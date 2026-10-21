import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { oneTimeToken as oneTimeTokenPlugin } from "better-auth/plugins";
import { z } from "zod";

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
 * 4. Generating a one-time token after OAuth callbacks and redirecting
 *    to the site with `?ott=<token>` so the frontend can exchange it
 *    for a session.
 * 5. Handing the studio a one-time token only for a host `isStudioHost`
 *    accepts, and exchanging one-time tokens for a new session of their
 *    own, so a site's session signs out and is revoked on its own.
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
  const oneTimeToken = oneTimeTokenPlugin();

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
      // After OAuth / magic-link callbacks, generate a one-time token and
      // redirect to the site URL with `?ott=<token>`
      {
        matcher: (ctx) =>
          Boolean(
            (ctx.path?.startsWith("/callback") ||
              ctx.path?.startsWith("/oauth2/callback") ||
              ctx.path?.startsWith("/magic-link/verify")) &&
            !isExpoNative(ctx),
          ),
        handler: createAuthMiddleware(async (ctx) => {
          const session = ctx.context.newSession;
          if (!session) {
            ctx.context.logger.error("No session found");
            return;
          }
          const token = generateRandomString(32);
          const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
          await ctx.context.internalAdapter.createVerificationValue({
            value: session.session.token,
            identifier: `one-time-token:${token}`,
            expiresAt,
          });
          const redirectTo = ctx.context.responseHeaders?.get("location");
          if (!redirectTo) {
            ctx.context.logger.error("No redirect to found");
            return;
          }
          const url = new URL(redirectTo);
          url.searchParams.set("ott", token);
          throw ctx.redirect(url.toString());
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
    endpoints: {
      generateOneTimeToken: oneTimeToken.endpoints.generateOneTimeToken,
      /**
       * What the dashboard's /studio-authorize page calls: the studio's callback URL with a
       * one-time token, when the signed-in user may use the studio on its host.
       */
      authorizeStudio: createAuthEndpoint(
        "/cross-domain/studio-authorize",
        {
          method: "POST",
          body: z.object({ callback: z.string() }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const callback = URL.parse(ctx.body.callback);
          if (!callback || !(await isStudioHost(callback, user.id))) {
            throw new APIError("FORBIDDEN", { message: "The studio can't sign in on this host" });
          }
          const token = generateRandomString(32);
          await ctx.context.internalAdapter.createVerificationValue({
            value: session.token,
            identifier: `one-time-token:${token}`,
            expiresAt: new Date(Date.now() + 3 * 60 * 1000),
          });
          callback.searchParams.set("ott", token);
          return ctx.json({ url: callback.toString() });
        },
      ),
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
            `one-time-token:${ctx.body.token}`,
          );
          if (!verification) throw new APIError("BAD_REQUEST", { message: "Invalid token" });
          const minting = await ctx.context.internalAdapter.findSession(verification.value);
          if (!minting || minting.session.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", { message: "Session expired" });
          }
          const session = await ctx.context.internalAdapter.createSession(minting.user.id);
          const signedIn = { session, user: minting.user };
          await setSessionCookie(ctx, signedIn);
          return ctx.json(signedIn);
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
