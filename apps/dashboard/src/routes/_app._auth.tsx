import { Toaster } from "@camox/ui/toaster";
import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Outlet />
      <Toaster theme="dark" />
    </div>
  );
}
