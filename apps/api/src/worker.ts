import { refreshFontsSnapshot } from "./domains/fonts/catalog";
import { isEdgeCached, withoutCredentials } from "./edge-cache";
import app from "./index";
import type { Bindings } from "./types";

export { AiJobScheduler } from "./durable-objects/ai-job-scheduler";
export { DraftCode } from "./durable-objects/draft-code";
export { EdgeCachePurger } from "./durable-objects/edge-cache-purger";
export { ProjectCode } from "./durable-objects/project-code";
export { ProjectRoom } from "./durable-objects/project-room";
export { Thread } from "./durable-objects/thread";
export { ReleaseWorkflow } from "./domains/releases/workflow";
export { ProjectCreationWorkflow } from "./domains/project-creation/workflow";
export { ProjectDeletionWorkflow } from "./domains/project-deletion/workflow";
export { ProjectUpgradeWorkflow } from "./domains/upgrades/project-workflow";
export { UpgradeWorkflow } from "./domains/upgrades/workflow";
export { EdgeCache } from "./edge-cache";

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    // Public reads go through the edge cache before any middleware runs.
    if (isEdgeCached(request)) {
      const { EdgeCache } = ctx.exports as unknown as { EdgeCache: Fetcher };
      return EdgeCache.fetch(withoutCredentials(request));
    }
    return app.fetch(request, env, ctx);
  },
  // The daily cron trigger (wrangler.jsonc): a new snapshot of Google Fonts for `searchFonts`.
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    await refreshFontsSnapshot(env);
  },
} satisfies ExportedHandler<Bindings>;
