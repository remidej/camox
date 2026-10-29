import { Spinner } from "@camox/ui/spinner";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/_auth/_authorize/connect-agent/")({
  // Where the authorization server sends a member connecting a Connected Agent (ADR 0030) before
  // they've signed in: the Dashboard's sign-in brings them back here.
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  head: () => ({
    meta: [{ title: "Connect to Camox" }],
  }),
  component: ConnectAgentPage,
});

/** The signature the authorization server adds to a request it sends to the Dashboard. */
const SIGNED_PARAMS = ["sig", "exp"];

/**
 * Sends a member who has just signed in back to the authorization request they started, which
 * now goes on to the consent screen.
 */
function ConnectAgentPage() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    for (const param of SIGNED_PARAMS) query.delete(param);
    const authorize = new URL(`${import.meta.env.VITE_API_URL}/api/auth/oauth2/authorize`);
    authorize.search = query.toString();
    window.location.replace(authorize.href);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Spinner />
      <p className="text-muted-foreground">Connecting to Camox…</p>
    </div>
  );
}
