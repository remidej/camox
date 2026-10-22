import type { CamoxApp } from "../../core/createApp";
import { createOgImageResponse } from "./pageRuntime";

export function createOgHandler(camoxApp: CamoxApp) {
  return {
    GET: ({ request }: { request: Request }) =>
      createOgImageResponse(camoxApp, new URL(request.url)),
  };
}
