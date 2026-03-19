import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { Link as RouterLink, Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ConvexReactClient } from "convex/react";
import { type ComponentProps, useCallback, useEffect } from "react";

import { authClient, useSession } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";
import { handleOttRedirect } from "@/lib/ott-redirect";

const convexUrl = import.meta.env.VITE_CONVEX_URL!;
const convexClient = new ConvexReactClient(convexUrl);

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken();
});

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
    const token = await getAuth();
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
      <AuthUIProvider
        authClient={authClient}
        navigate={navigate}
        replace={replace}
        Link={LinkAdapter}
        basePath=""
        viewPaths={{
          SIGN_IN: "login",
          SIGN_UP: "signup",
          FORGOT_PASSWORD: "forgot-password",
        }}
        account={{ basePath: "/dashboard", viewPaths: { SETTINGS: "profile" } }}
        avatar
        credentials={{ forgotPassword: true }}
        social={{ providers: ["github", "google"] }}
      >
        <div className="font-['Inter',sans-serif] antialiased">
          <Outlet />
        </div>
      </AuthUIProvider>
    </ConvexBetterAuthProvider>
  );
}
