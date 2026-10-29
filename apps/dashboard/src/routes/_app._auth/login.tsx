import { AuthView } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_app/_auth/login")({
  component: LoginPage,
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
});

/** Whether signing in is part of connecting a Connected Agent: it returns to `/connect-agent`. */
const connectsAgent = (redirect: string | undefined) =>
  redirect !== undefined &&
  URL.canParse(redirect, "https://dashboard.invalid") &&
  new URL(redirect, "https://dashboard.invalid").pathname.startsWith("/connect-agent");

function LoginPage() {
  const { redirect } = Route.useSearch();

  if (!connectsAgent(redirect)) {
    return <AuthView view="SIGN_IN" redirectTo={redirect ?? "/"} callbackURL={redirect} />;
  }
  // Connecting a Connected Agent offers no sign-up (#705): the card's sign-up link is hidden,
  // and a member with no account creates one in the Dashboard, outside the flow.
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <AuthView
        view="SIGN_IN"
        redirectTo={redirect}
        callbackURL={redirect}
        classNames={{ footer: "hidden" }}
      />
      <p className="text-muted-foreground text-center text-sm">
        No Camox account yet?{" "}
        <a className="text-foreground underline" href="/signup" target="_blank" rel="noreferrer">
          Create one in the Camox Dashboard
        </a>
        , then connect again from your AI.
      </p>
    </div>
  );
}
