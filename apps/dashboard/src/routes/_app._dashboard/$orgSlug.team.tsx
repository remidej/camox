import { createFileRoute, redirect } from "@tanstack/react-router";

// Studio builds from older SDK versions still link here.
export const Route = createFileRoute("/_app/_dashboard/$orgSlug/team")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$orgSlug/members", params });
  },
});
