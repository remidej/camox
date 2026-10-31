import type { BetterAuthClientPlugin, ClientStore } from "better-auth";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as React from "react";

import { actionsStore } from "@/features/provider/actionsStore";

import { validatePreviewTarget, type PreviewTarget } from "./preview-handoff";
import {
  buildClearServerAuthCookieHeader,
  buildServerAuthCookieHeader,
  readServerAuthCookie,
} from "./server-auth-cookie";
import {
  type StoredCookie,
  getCookie,
  getSetCookie,
  parseSetCookieHeader,
  withCookieHeader,
} from "./stored-auth-cookies";
export { buildClearServerAuthCookieHeader, getServerAuthCookieHeader } from "./server-auth-cookie";

/* -------------------------------------------------------------------------------------------------
 * Cross-domain client plugin
 *
 * Stores session cookies in localStorage and sends them via a custom
 * `Better-Auth-Cookie` header, since browsers won't send real cookies across
 * different origins. Companion to the server-side `crossDomain` plugin.
 *
 * Adapted from `@convex-dev/better-auth/client/plugins`.
 * -----------------------------------------------------------------------------------------------*/

function writeServerAuthCookie(cookie: string) {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:";
  if (!cookie) {
    document.cookie = `${buildClearServerAuthCookieHeader()}${secure ? "; Secure" : ""}`;
    return;
  }

  document.cookie = buildServerAuthCookieHeader(cookie, { secure });
}

const STORED_COOKIES_KEY = "better-auth_cookie";

/**
 * The stored cookies, with the session the website's Worker signed in with added: it exchanges a
 * sign-in's one-time token itself and sets only the mirror. Read storage through this alone,
 * since reading it writes the mirror back from storage.
 */
function readStoredCookies(
  storage: Pick<Storage, "getItem" | "setItem">,
  key = STORED_COOKIES_KEY,
): string {
  const stored = storage.getItem(key) || "{}";
  if (typeof document === "undefined") return stored;
  const adopted = withCookieHeader(stored, readServerAuthCookie(document.cookie));
  if (!adopted) return stored;
  storage.setItem(key, adopted);
  return adopted;
}

/**
 * Read the cross-domain auth cookie from localStorage and return it as a
 * string suitable for the `Better-Auth-Cookie` request header.
 */
export function getAuthCookieHeader(): string {
  if (typeof window === "undefined") return "";
  const cookie = getCookie(readStoredCookies(localStorage));
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
        getCookie: () => (storage ? getCookie(readStoredCookies(storage, cookieName)) : ""),
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
          const cookie = getCookie(readStoredCookies(storage, cookieName));
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
 * The Worker exchanges a studio sign-in's token before rendering, so this handles a preview
 * link's, and any token the Worker couldn't exchange.
 *
 * Reports completion and explicit handoff failures instead of silently showing live content.
 * Keeps the handoff marker until SSR confirms authentication on the subsequent load.
 */
export function useProcessOtt(
  authClient: CamoxAuthClient,
  target: PreviewTarget,
  initialAuthenticated = false,
) {
  const { projectUuid, apiUrl } = target;
  const [error, setError] = React.useState<string | null>(null);
  const processing = React.useRef(false);
  const [ready, setReady] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return !new URL(window.location.href).searchParams.has("ott");
  });

  React.useEffect(() => {
    const url = new URL(window.location.href);
    const targetError = validatePreviewTarget(url.searchParams.get("camox-preview"), {
      projectUuid,
      apiUrl,
    });
    if (targetError) {
      url.searchParams.delete("ott");
      window.history.replaceState(window.history.state, "", url);
      // oxlint-disable-next-line react/set-state-in-effect -- result depends on window.location, unknown during SSR
      setError(targetError);
      setReady(true);
      return;
    }
    if (ready) {
      if (initialAuthenticated && !error && url.searchParams.has("camox-preview")) {
        url.searchParams.delete("camox-preview");
        window.history.replaceState(window.history.state, "", url);
      }
      return;
    }
    if (processing.current) return;

    const ott = url.searchParams.get("ott");
    if (!ott) {
      setReady(true);
      return;
    }

    processing.current = true;
    // Strip ?ott= immediately so it's not processed again
    url.searchParams.delete("ott");
    window.history.replaceState(window.history.state, "", url);

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
        setError(
          "Preview sign-in failed. The link may have expired or already been used. Restart the dev server for a fresh link.",
        );
      }
      setReady(true);
    })();
  }, [authClient, ready, error, initialAuthenticated, projectUuid, apiUrl]);

  return { ready, error };
}

/* -------------------------------------------------------------------------------------------------
 * React context
 * -----------------------------------------------------------------------------------------------*/

interface AuthContextValue {
  initialAuthenticated?: boolean;
  /** Whether a `?ott=` one-time token is still being exchanged for a session. */
  exchangingToken?: boolean;
  /** Whether the page has no session to ask about, as the look document: always signed out. */
  sessionless?: boolean;
  authClient: CamoxAuthClient;
  authenticationUrl: string;
  apiUrl: string;
  projectUuid: string;
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

export function useProjectUuid() {
  return useAuthContext().projectUuid;
}

const subscribeToHydration = () => () => {};

function hasStoredAuthCookie() {
  return getCookie(readStoredCookies(localStorage)) !== "";
}

const noSubscription = () => () => {};

/**
 * The session, from the client's session store. Listening to the store fetches the session from
 * the API, so an untracked session stays unfetched.
 */
function useSessionState(authClient: CamoxAuthClient, track: boolean) {
  const sessionAtom = authClient.$store.atoms.session;
  // `value`, unlike `get()`, reads the store without mounting it, which would fetch.
  const getSnapshot = () => sessionAtom.value as { data: unknown; isPending: boolean };
  const subscribe = React.useCallback(
    (onChange: () => void) => sessionAtom.listen(onChange),
    [sessionAtom],
  );
  return React.useSyncExternalStore(track ? subscribe : noSubscription, getSnapshot, getSnapshot);
}

/** The id of the member signed in, as the session the client holds says: null without one. */
export function signedInUserId(authClient: CamoxAuthClient): string | null {
  const session = authClient.$store.atoms.session.value as {
    data?: { user?: { id?: string } } | null;
  };
  return session.data?.user?.id ?? null;
}

export function useAuthState() {
  const {
    authClient,
    initialAuthenticated = false,
    exchangingToken = false,
    sessionless = false,
  } = useAuthContext();
  const hydrated = React.useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  // Sessions live in localStorage, or the server saw one. Without either the visitor is
  // anonymous: don't ask the API.
  const tracksSession =
    !sessionless && (initialAuthenticated || (hydrated && hasStoredAuthCookie()));
  const { data: session, isPending } = useSessionState(authClient, tracksSession);
  // Not signed in yet, but about to be: a sign-in redirect now would fetch another token, and
  // land back here before this one is exchanged, forever.
  if (exchangingToken && !initialAuthenticated) return { isAuthenticated: false, isLoading: true };
  if (!tracksSession) return { isAuthenticated: false, isLoading: !hydrated };
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
