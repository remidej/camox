import { Button } from "@camox/ui/button";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { signOut } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: undefined } });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", search: { redirect: undefined } });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="flex h-14 items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">camox</span>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Log out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
