import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { AccountSettingsCards, SecuritySettingsCards } from "@daveyplate/better-auth-ui";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { ConnectedAgentsCard } from "@/components/ConnectedAgentsCard";

const tabs = ["account", "security"] as const;
type Tab = (typeof tabs)[number];

export const Route = createFileRoute("/_app/_dashboard/profile")({
  component: ProfilePage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: tabs.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  head: () => ({
    meta: [{ title: "Profile – Camox Dashboard" }],
  }),
});

function ProfilePage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!tab) {
      void navigate({ to: "/profile", search: { tab: "account" }, replace: true });
    }
  }, [tab, navigate]);

  const activeTab = tab ?? "account";

  return (
    <div className="flex flex-col items-stretch gap-6 py-6">
      <div className="px-6">
        <Tabs value={activeTab} className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger
              value="account"
              nativeButton={false}
              render={<Link to="/profile" search={{ tab: "account" }} />}
            >
              Account
            </TabsTrigger>
            <TabsTrigger
              value="security"
              nativeButton={false}
              render={<Link to="/profile" search={{ tab: "security" }} />}
            >
              Security
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {activeTab === "security" ? (
          <>
            <SecuritySettingsCards />
            <ConnectedAgentsCard />
          </>
        ) : (
          <AccountSettingsCards />
        )}
      </div>
    </div>
  );
}
