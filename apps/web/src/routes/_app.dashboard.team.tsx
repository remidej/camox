import { Button } from "@camox/ui/button";
import {
  OrganizationMembersCard,
  OrganizationSettingsCards,
  OrganizationSwitcher,
} from "@daveyplate/better-auth-ui";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard/team")({
  component: TeamPage,
  head: () => ({
    meta: [{ title: "Team – Camox Dashboard" }],
  }),
});

function TeamPage() {
  return (
    <div>
      <div className="border-border border-b px-4 py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard">
            <ArrowLeftIcon className="text-muted-foreground" />
            Dashboard
          </Link>
        </Button>
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
        <OrganizationSwitcher
          variant="ghost"
          size="default"
          className="min-w-64 self-start"
          hidePersonal
        />
        <OrganizationMembersCard />
        <OrganizationSettingsCards />
      </div>
    </div>
  );
}
