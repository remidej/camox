import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
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
 *
 * Adapted from `@convex-dev/better-auth/plugins/cross-domain`.
 */
export function crossDomain({ siteUrl }: { siteUrl: string }) {
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
      verifyOneTimeToken: createAuthEndpoint(
        "/cross-domain/one-time-token/verify",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const response = await oneTimeToken.endpoints.verifyOneTimeToken({
            ...ctx,
            returnHeaders: false,
            returnStatus: false,
          });
          await setSessionCookie(ctx, response);
          return response;
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
