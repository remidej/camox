import { UserButton } from "@daveyplate/better-auth-ui";
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: undefined } });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="flex items-center justify-between px-6 py-2">
          <Link to="/dashboard" className="text-lg font-semibold tracking-tight">
            camox
          </Link>
          <UserButton size="sm" variant="outline" />
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
