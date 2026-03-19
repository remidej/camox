import { AccountSettingsCards, SecuritySettingsCards } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/dashboard/profile")({
  component: ProfilePage,
  head: () => ({
    meta: [{ title: "Camox Profile" }],
  }),
});

function ProfilePage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="border-border grid grid-cols-[1fr_2fr] gap-x-8 border-b px-4 py-4">
        <div>
          <p className="text-sm font-medium">Account</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Manage your personal information and preferences
          </p>
        </div>
        <div>
          <AccountSettingsCards />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_2fr] gap-x-8 px-4 py-4">
        <div>
          <p className="text-sm font-medium">Security</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Manage your password and authentication methods
          </p>
        </div>
        <div>
          <SecuritySettingsCards />
        </div>
      </div>
    </div>
  );
}
