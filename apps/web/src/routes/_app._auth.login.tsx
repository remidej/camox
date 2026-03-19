import { AuthView } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_auth/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const callbackURL = redirect ? `/dashboard?redirect=${encodeURIComponent(redirect)}` : undefined;

  return <AuthView view="SIGN_IN" redirectTo="/dashboard" callbackURL={callbackURL} />;
}
