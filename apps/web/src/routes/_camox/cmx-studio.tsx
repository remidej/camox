import { Outlet, createFileRoute } from "@tanstack/react-router";
import { CamoxStudio } from "camox/CamoxStudio";

export const Route = createFileRoute("/_camox/cmx-studio")({
  component: RouteComponent,
  notFoundComponent: () => <div>Studio page not found</div>,
});

function RouteComponent() {
  return (
    <CamoxStudio>
      <Outlet />
    </CamoxStudio>
  );
}
