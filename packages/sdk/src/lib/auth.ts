import type { BetterAuthClientPlugin, ClientStore } from "better-auth";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as React from "react";

import { actionsStore } from "@/features/provider/actionsStore";

/* -------------------------------------------------------------------------------------------------
 * Cross-domain client plugin
 *
 * Stores session cookies in localStorage and sends them via a custom
 * `Better-Auth-Cookie` header, since browsers won't send real cookies across
 * different origins. Companion to the server-side `crossDomain` plugin.
 *
 * Adapted from `@convex-dev/better-auth/client/plugins`.
 * -----------------------------------------------------------------------------------------------*/

interface CookieAttributes {
  value: string;
  expires?: Date;
  "max-age"?: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

interface StoredCookie {
  value: string;
  expires: string | null;
}

const SERVER_AUTH_COOKIE_NAME = "camox_auth_cookie";

export function buildClearServerAuthCookieHeader() {
  return `${SERVER_AUTH_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function writeServerAuthCookie(cookie: string) {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!cookie) {
    document.cookie = `${buildClearServerAuthCookieHeader()}${secure}`;
    return;
  }

  document.cookie = `${SERVER_AUTH_COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function getServerAuthCookieHeader(headers: Headers): string {
  const cookieHeader = headers.get("Cookie") ?? headers.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const authCookie = cookies.find((part) => part.startsWith(`${SERVER_AUTH_COOKIE_NAME}=`));
  if (!authCookie) return "";

  const value = authCookie.slice(SERVER_AUTH_COOKIE_NAME.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function parseSetCookieHeader(header: string): Map<string, CookieAttributes> {
  const cookieMap = new Map<string, CookieAttributes>();
  const cookies = header.split(", ");
  cookies.forEach((cookie) => {
    const [nameValue, ...attributes] = cookie.split("; ");
    const [name, value] = nameValue.split("=");

    const cookieObj: CookieAttributes = { value };

    attributes.forEach((attr) => {
      const [attrName, attrValue] = attr.split("=");
      cookieObj[attrName.toLowerCase() as "value"] = attrValue;
    });

    cookieMap.set(name, cookieObj);
  });

  return cookieMap;
}

function getSetCookie(header: string, prevCookie?: string) {
  const parsed = parseSetCookieHeader(header);
  let toSetCookie: Record<string, StoredCookie> = {};
  parsed.forEach((cookie, key) => {
    const expiresAt = cookie["expires"];
    const maxAge = cookie["max-age"];
    let expires: Date | null = null;
    if (expiresAt) {
      expires = new Date(String(expiresAt));
    } else if (maxAge) {
      expires = new Date(Date.now() + Number(maxAge) * 1000);
    }
    toSetCookie[key] = {
      value: cookie["value"],
      expires: expires ? expires.toISOString() : null,
    };
  });
  if (prevCookie) {
    try {
      const prevCookieParsed = JSON.parse(prevCookie);
      toSetCookie = {
        ...prevCookieParsed,
        ...toSetCookie,
      };
    } catch {
      //
    }
  }
  return JSON.stringify(toSetCookie);
}

function getCookie(cookie: string) {
  let parsed = {} as Record<string, StoredCookie>;
  try {
    parsed = JSON.parse(cookie) as Record<string, StoredCookie>;
  } catch {
    // noop
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value.expires && new Date(value.expires) < new Date()) {
      continue;
    }
    parts.push(`${key}=${value.value}`);
  }
  return parts.join("; ");
}

/**
 * Read the cross-domain auth cookie from localStorage and return it as a
 * string suitable for the `Better-Auth-Cookie` request header.
 */
export function getAuthCookieHeader(): string {
  if (typeof window === "undefined") return "";
  const cookie = getCookie(localStorage.getItem("better-auth_cookie") || "{}");
  writeServerAuthCookie(cookie);
  return cookie;
}

export function getAuthRequestCredentials(authCookieHeader = getAuthCookieHeader()) {
  return authCookieHeader ? "omit" : "include";
}

function crossDomainClient(
  opts: {
    storage?: {
      setItem: (key: string, value: string) => any;
      getItem: (key: string) => string | null;
    };
    storagePrefix?: string;
    disableCache?: boolean;
  } = {},
) {
  let store: ClientStore | null = null;
  const cookieName = `${opts?.storagePrefix || "better-auth"}_cookie`;
  const localCacheName = `${opts?.storagePrefix || "better-auth"}_session_data`;
  const storage = opts?.storage || (typeof window !== "undefined" ? localStorage : undefined);

  return {
    id: "cross-domain",
    getActions(_: any, $store: ClientStore) {
      store = $store;
      return {
        getCookie: () => {
          const cookie = storage?.getItem(cookieName);
          return getCookie(cookie || "{}");
        },
        updateSession: () => {
          $store.notify("$sessionSignal");
        },
        getSessionData: (): Record<string, unknown> | null => {
          const sessionData = storage?.getItem(localCacheName);
          if (!sessionData) return null;
          try {
            const parsed = JSON.parse(sessionData);
            if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0)
              return null;
            return parsed;
          } catch {
            return null;
          }
        },
      };
    },
    fetchPlugins: [
      {
        id: "cross-domain",
        name: "Cross Domain",
        hooks: {
          async onSuccess(context: any) {
            if (!storage) return;

            const setCookie = context.response.headers.get("set-better-auth-cookie");
            if (setCookie) {
              const prevCookie = storage.getItem(cookieName);
              const toSetCookie = getSetCookie(setCookie || "", prevCookie ?? undefined);
              await storage.setItem(cookieName, toSetCookie);
              writeServerAuthCookie(getCookie(toSetCookie));

              if (setCookie.includes(".session_token=")) {
                const parsed = parseSetCookieHeader(setCookie);
                let prevParsed: Record<string, StoredCookie> = {};
                try {
                  prevParsed = JSON.parse(prevCookie || "{}");
                } catch {
                  // noop
                }
                const tokenKey = [...parsed.keys()].find((k) => k.includes("session_token"));
                if (tokenKey && prevParsed[tokenKey]?.value !== parsed.get(tokenKey)?.value) {
                  store?.notify("$sessionSignal");
                }
              }
            }

            if (context.request.url.toString().includes("/get-session") && !opts?.disableCache) {
              const data = context.data;
              storage.setItem(localCacheName, JSON.stringify(data));
              if (data === null) {
                storage.setItem(cookieName, "{}");
                writeServerAuthCookie("");
              } else {
                writeServerAuthCookie(getCookie(storage.getItem(cookieName) || "{}"));
              }
            }
          },
        },
        async init(url: string, options: any) {
          if (!storage) {
            return { url, options };
          }
          options = options || {};
          const storedCookie = storage.getItem(cookieName);
          const cookie = getCookie(storedCookie || "{}");
          writeServerAuthCookie(cookie);
          options.credentials = getAuthRequestCredentials(cookie);
          options.headers = {
            ...options.headers,
            // Header presence identifies SDK cross-domain requests to the API.
            // Keep it even when there is no cookie yet so the first OTT exchange
            // can return its session through `Set-Better-Auth-Cookie`.
            "Better-Auth-Cookie": cookie,
          };
          if (url.includes("/sign-out")) {
            await storage.setItem(cookieName, "{}");
            writeServerAuthCookie("");
            store?.atoms.session?.set({
              data: null,
              error: null,
              isPending: false,
            });
            storage.setItem(localCacheName, "{}");
          }
          return { url, options };
        },
      },
    ],
  } satisfies BetterAuthClientPlugin;
}

/* -------------------------------------------------------------------------------------------------
 * Auth client factory
 * -----------------------------------------------------------------------------------------------*/

export type CamoxAuthClient = ReturnType<typeof createCamoxAuthClient>;

export function createCamoxAuthClient(apiUrl: string) {
  return createAuthClient({
    baseURL: apiUrl,
    plugins: [crossDomainClient(), organizationClient(), oneTimeTokenClient()],
  });
}

/**
 * Process a `?ott=` one-time token from the URL before the provider mounts.
 * Verifies the token against the API backend and notifies the session store.
 *
 * Returns `true` once processing is complete (or if there was no OTT).
 */
export function useProcessOtt(authClient: CamoxAuthClient) {
  const [ready, setReady] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return !new URL(window.location.href).searchParams.has("ott");
  });

  React.useEffect(() => {
    if (ready) return;

    const url = new URL(window.location.href);
    const ott = url.searchParams.get("ott");
    if (!ott) {
      setReady(true);
      return;
    }

    // Strip ?ott= immediately so it's not processed again
    url.searchParams.delete("ott");
    window.history.replaceState({}, "", url);

    void (async () => {
      try {
        const verification = await authClient.oneTimeToken.verify({ token: ott });
        if (verification.error) throw verification.error;
        if (!verification.data) throw new Error("OTT verification returned no session");

        // The fetch hook has persisted the session in localStorage and mirrored it
        // into the first-party server cookie. Reload the URL after stripping the
        // one-time token so SSR and the client both start authenticated.
        window.location.reload();
        return;
      } catch {
        // OTT verification failed — continue unauthenticated
      }
      setReady(true);
    })();
  }, [authClient, ready]);

  return ready;
}

/* -------------------------------------------------------------------------------------------------
 * React context
 * -----------------------------------------------------------------------------------------------*/

interface AuthContextValue {
  initialAuthenticated?: boolean;
  authClient: CamoxAuthClient;
  authenticationUrl: string;
  apiUrl: string;
  projectSlug: string;
  environmentName?: string;
}

export const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuthContext() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("Missing CamoxProvider");
  return ctx;
}

/* -------------------------------------------------------------------------------------------------
 * Hooks
 * -----------------------------------------------------------------------------------------------*/

export function useProjectSlug() {
  return useAuthContext().projectSlug;
}

const subscribeToHydration = () => () => {};

export function useAuthState() {
  const { authClient, initialAuthenticated = false } = useAuthContext();
  const { data: session, isPending } = authClient.useSession();
  const hydrated = React.useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  // Presentation only: every API operation still validates the actual session.
  const useInitial = !hydrated || isPending;
  return {
    isAuthenticated: useInitial ? initialAuthenticated : !!session,
    isLoading: useInitial && !initialAuthenticated,
  };
}

export function useIsAuthenticated() {
  const { isAuthenticated } = useAuthState();
  return isAuthenticated;
}

type SignInRedirectCallbackHref = string | (() => string | undefined);

export function useSignInRedirect(callbackHref?: SignInRedirectCallbackHref) {
  const { authenticationUrl } = useAuthContext();

  return React.useCallback(() => {
    if (typeof window === "undefined") return;

    const href = typeof callbackHref === "function" ? callbackHref() : callbackHref;
    const callback = encodeURIComponent(href ?? window.location.href);
    window.location.href = `${authenticationUrl}/studio-authorize?callback=${callback}`;
  }, [authenticationUrl, callbackHref]);
}

/**
 * Registers sign-out and manage-account actions in the command palette.
 */
export function useAuthActions() {
  const { authClient, authenticationUrl } = useAuthContext();

  React.useEffect(() => {
    actionsStore.send({
      type: "registerManyActions",
      actions: [
        {
          id: "manage-account",
          label: "Manage account",
          aliases: ["Account settings", "Profile", "User settings"],
          groupLabel: "Studio",
          checkIfAvailable: () => true,
          execute: () => {
            window.open(`${authenticationUrl}/profile`, "_blank");
          },
        },
        {
          id: "log-out",
          label: "Log out",
          aliases: ["Sign out", "Logout"],
          groupLabel: "Studio",
          checkIfAvailable: () => true,
          execute: () => authClient.signOut(),
        },
      ],
    });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: ["manage-account", "log-out"],
      });
    };
  }, [authClient, authenticationUrl]);
}
