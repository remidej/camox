import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_camox/cmx")({
  component: RouteComponent,
  loader: () => {
    // @ts-expect-error
    throw redirect("/cmx-studio");
  },
});

function RouteComponent() {
  return null;
}
