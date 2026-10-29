import { env, waitUntil } from "cloudflare:workers";

import type { ServiceContext } from "../_shared/service-context";

/** Camox's own context, outside any request: it acts with no session. */
export const camoxContext = (db: ServiceContext["db"]): ServiceContext => ({
  db,
  user: null,
  env,
  waitUntil,
  client: "camox",
  telemetryDisabled: true,
  draft: null,
});
