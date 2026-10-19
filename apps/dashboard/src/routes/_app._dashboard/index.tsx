import { createFileRoute, redirect } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";

import { organizationQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard/")({
  head: () => ({
    meta: [{ title: "Camox Dashboard" }],
  }),
  // Redirect before rendering, so the server answers with the redirect and the
  // empty state only shows to users who really have no organization.
  beforeLoad: async ({ context }) => {
    const organizations = await context.queryClient.ensureQueryData(organizationQueries.list());
    const activeOrganizationId = context.session?.session.activeOrganizationId;
    const org =
      organizations.find((candidate) => candidate.id === activeOrganizationId) ?? organizations[0];
    if (org) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: org.slug }, replace: true });
    }
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="text-muted-foreground flex flex-col items-center gap-3 py-20 text-center">
        <FolderIcon className="h-10 w-10" />
        <h2 className="text-foreground text-lg font-semibold">No organizations found</h2>
      </div>
    </div>
  );
}
