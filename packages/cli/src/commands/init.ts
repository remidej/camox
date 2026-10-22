import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { command, constant } from "@optique/core/primitives";

export const parser = command(
  "init",
  object({
    command: constant("init"),
  }),
);

export const handler = init;

const DASHBOARD_URL = process.env.CAMOX_URL || "https://app.camox.dev";

/**
 * Projects are created from the dashboard, which hosts them, so `camox init` (and
 * `npm create camox`, which runs it) only says where to go. It exits non-zero, since it created
 * nothing.
 */
export function init() {
  p.intro("camox init");
  p.log.info(`Projects are now created from the Camox dashboard: ${DASHBOARD_URL}`);
  p.outro("Nothing was created.");
  process.exit(1);
}
