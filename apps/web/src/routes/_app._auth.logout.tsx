import { AuthView } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_auth/logout")({
  component: LogoutPage,
});

function LogoutPage() {
  return <AuthView view="SIGN_OUT" redirectTo="/login" />;
}
