import { Outlet, createFileRoute } from "@tanstack/react-router";
import { CamoxProvider } from "camox/CamoxProvider";
import { camoxApp } from "@/camox";
import { env } from "@/env";

export const Route = createFileRoute("/_camox")({
  component: CamoxPathlessLayout,
});

function CamoxPathlessLayout() {
  return (
    <CamoxProvider camoxApp={camoxApp} convexUrl={env.VITE_CONVEX_URL}>
      <Outlet />
    </CamoxProvider>
  );
}
