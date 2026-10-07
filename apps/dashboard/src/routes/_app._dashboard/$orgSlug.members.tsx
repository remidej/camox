import { OrganizationMembersCard } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug/members")({
  component: MembersPage,
  head: () => ({
    meta: [{ title: "Members – Camox Dashboard" }],
  }),
});

function MembersPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <OrganizationMembersCard />
    </div>
  );
}
