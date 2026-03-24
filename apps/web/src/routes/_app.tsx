import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link as RouterLink, Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type ComponentProps, useCallback, useEffect } from "react";

import { authClient, useSession } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";
import { convexClient, queryClient } from "@/lib/convex";
import { handleOttRedirect } from "@/lib/ott-redirect";

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  // First try the standard getToken() (works when real cookies exist, e.g. OAuth)
  const token = await getToken();
  if (token) return token;

  // Fallback: read the plain convex_jwt cookie set by syncToken()
  const { getRequestHeaders } = await import("@tanstack/react-start/server");
  const cookies = getRequestHeaders().get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)convex_jwt=([^;]+)/);
  return match?.[1] ?? null;
});

/** Sync the convex_jwt to a real HTTP cookie via the API route */
async function syncToken(token: string) {
  await fetch("/api/sync-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

/**
 * Read the convex_jwt from crossDomainClient's localStorage store.
 * This works on the client where `beforeLoad` runs during SPA navigation.
 * Falls back to the server function for SSR / full page loads (OAuth flows).
 */
function getClientToken(): string | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem("better-auth_cookie");
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Record<string, { value: string; expires: string | null }>;
    const jwtKey = Object.keys(stored).find((k) => k.endsWith("convex_jwt"));
    const jwt = jwtKey ? stored[jwtKey] : undefined;

    if (!jwt?.value) return null;
    if (jwt.expires && new Date(jwt.expires) < new Date()) return null;

    return jwt.value;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/_app")({
  head: () => ({
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
      },
    ],
  }),
  beforeLoad: async () => {
    // Try client-side first (works after crossDomain sign-in via localStorage),
    // fall back to server function (works for OAuth flows that set real cookies).
    const token = getClientToken() ?? (await getAuth());
    return { isAuthenticated: !!token, token };
  },
  component: AppLayout,
});

function LinkAdapter({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  return <RouterLink to={href} {...props} />;
}

function AppLayout() {
  const { token } = Route.useRouteContext();
  const router = useRouter();
  const { data: session } = useSession();

  // After social auth (OAuth redirect), the user lands on the callbackURL via
  // a full page load. Once the session is established (e.g. after crossDomain
  // OTT verification), redirect back to the originating app if ?redirect= is present.
  useEffect(() => {
    if (session) {
      handleOttRedirect();
    }
  }, [session]);

  const onSessionChange = useCallback(async () => {
    const clientToken = getClientToken();
    if (clientToken) {
      await syncToken(clientToken);
    }
    await router.invalidate();
  }, [router]);

  const navigate = useCallback(
    async (href: string) => {
      if (await handleOttRedirect()) return;
      router.navigate({ to: href });
    },
    [router],
  );

  const replace = useCallback(
    async (href: string) => {
      if (await handleOttRedirect()) return;
      router.navigate({ to: href, replace: true });
    },
    [router],
  );

  return (
    <ConvexBetterAuthProvider client={convexClient} authClient={authClient} initialToken={token}>
      <QueryClientProvider client={queryClient}>
        <AuthUIProvider
          authClient={authClient}
          navigate={navigate}
          replace={replace}
          onSessionChange={onSessionChange}
          Link={LinkAdapter}
          basePath=""
          viewPaths={{
            SIGN_IN: "login",
            SIGN_UP: "signup",
            SIGN_OUT: "logout",
            FORGOT_PASSWORD: "forgot-password",
          }}
          account={{ basePath: "", viewPaths: { SETTINGS: "dashboard/profile" } }}
          organization={{
            basePath: "",
            logo: true,
            viewPaths: {
              SETTINGS: "dashboard/team",
            },
          }}
          avatar
          credentials={{ forgotPassword: true }}
          social={{ providers: ["github", "google"] }}
        >
          <div className="font-['Inter',sans-serif] antialiased">
            <Outlet />
          </div>
        </AuthUIProvider>
      </QueryClientProvider>
    </ConvexBetterAuthProvider>
  );
}
