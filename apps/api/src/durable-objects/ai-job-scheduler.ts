import { queryKeys, type QueryKey } from "@camox/api-contract/query-keys";
import { DurableObject } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { createDb } from "../db";
import { requestBlockSummary, runBlockSummaryJob } from "../domains/blocks/service";
import { storedIn, storedInLiveOrDraft } from "../domains/drafts/overlay";
import { runFileMetadataJob } from "../domains/files/service";
import { runPageSeoJob } from "../domains/pages/ai";
import { requestPageSeo } from "../domains/pages/service";
import { rootOfItem } from "../domains/repeatable-items/roots";
import { runRepeatableItemSummaryJob } from "../domains/repeatable-items/service";
import { broadcastInvalidation } from "../lib/broadcast-invalidation";
import { retryAiCall } from "../lib/retry-ai-call";
import { blocks, environments, repeatableItems } from "../schema";
import type { Bindings } from "../types";

type JobParams = {
  entityTable: string;
  entityId: string;
  type: string;
  delayMs: number;
  /** The draft the job was scheduled from; absent on jobs stored before drafts and on Live's. */
  draftId?: string | null;
};

type StoredJob = JobParams & {
  /** Distinguishes a re-scheduled job from the one an in-flight alarm is running. */
  id: string;
};

export class AiJobScheduler extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/schedule") {
      const params: JobParams = await request.json();
      await this.ctx.storage.put("job", { ...params, id: crypto.randomUUID() } satisfies StoredJob);
      await this.ctx.storage.setAlarm(Date.now() + params.delayMs);
      return new Response(JSON.stringify({ scheduled: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<StoredJob>("job");
    if (!job) return;

    // Only clear the job once it succeeded. If it fails, the job stays stored
    // and Cloudflare retries the alarm with backoff.
    await Effect.runPromise(this.runJob(job));

    // A newer job may have been scheduled while this one ran — keep it.
    const current = await this.ctx.storage.get<StoredJob>("job");
    if (current?.id === job.id) {
      await this.ctx.storage.delete("job");
    }
  }

  private runJob = Effect.fn("AiJobScheduler.runJob")(function* (
    this: AiJobScheduler,
    job: StoredJob,
  ) {
    const db = createDb(this.env.DB);
    const apiKey = this.env.OPEN_ROUTER_API_KEY;
    const deps = { db, env: this.env, waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p) };

    const { entityTable, entityId, type } = job;
    const draftId = job.draftId ?? null;
    const label = `${entityTable}:${entityId}:${type}:${draftId ?? "live"}`;
    const refresh = (projectId: number, targets: QueryKey[]) =>
      broadcastInvalidation({
        waitUntil: deps.waitUntil,
        projectRoomNamespace: this.env.ProjectRoom,
        draftId,
        projectId,
        targets,
      });
    const summaryTargets = [
      queryKeys.pages.getByPathAll,
      ["camox", "blocks"] as QueryKey,
      queryKeys.blocks.getUsageCounts,
    ];

    if (entityTable === "blocks" && type === "summary") {
      const stale = yield* retryAiCall(label, (abortController) =>
        runBlockSummaryJob(db, apiKey, { entityId, draftId }, abortController),
      );
      // A changed summary changes its page's SEO.
      if (stale) yield* requestPageSeo(deps, stale.scope, stale.page, 15000);
      const projectId = yield* Effect.promise(() => this.getBlockProjectId(db, entityId));
      if (projectId) refresh(projectId, summaryTargets);
    } else if (entityTable === "repeatableItems" && type === "summary") {
      const cascade = yield* retryAiCall(label, (abortController) =>
        runRepeatableItemSummaryJob(db, apiKey, { entityId, draftId }, abortController),
      );
      // A changed item summary changes its block's.
      if (cascade) {
        yield* requestBlockSummary(deps, cascade.scope, cascade.projectId, cascade.blockId, 5000);
      }
      const item = yield* Effect.promise(() =>
        db
          .select()
          .from(repeatableItems)
          .where(
            and(
              eq(repeatableItems.id, entityId),
              draftId
                ? storedInLiveOrDraft(repeatableItems, draftId)
                : storedIn(repeatableItems, null),
            ),
          )
          .get(),
      );
      if (item) {
        // A shared content's item names its environment instead of a block.
        const root = rootOfItem(item);
        const projectId = yield* Effect.promise(() =>
          "blockId" in root
            ? this.getBlockProjectId(db, root.blockId)
            : this.getEnvironmentProjectId(db, root.sharedContent.environmentId),
        );
        if (projectId) refresh(projectId, summaryTargets);
      }
    } else if (entityTable === "files" && type === "fileMetadata") {
      const projectId = yield* retryAiCall(label, (abortController) =>
        runFileMetadataJob(db, apiKey, { entityId, draftId }, abortController),
      );
      if (projectId) refresh(projectId, [queryKeys.files.list, queryKeys.files.get(entityId)]);
    } else if (entityTable === "pages" && type === "seo") {
      const done = yield* retryAiCall(label, (abortController) =>
        runPageSeoJob(db, apiKey, { entityId, draftId }, abortController),
      );
      if (done) {
        refresh(done.projectId, [
          queryKeys.pages.list,
          queryKeys.pages.getById(entityId),
          queryKeys.pages.getByPathAll,
          // A pending meta title is a publish warning, a missing one a blocker.
          queryKeys.drafts.all,
        ]);
      }
    }
  });

  private async getEnvironmentProjectId(
    db: ReturnType<typeof createDb>,
    environmentId: number,
  ): Promise<number | null> {
    const result = await db
      .select({ projectId: environments.projectId })
      .from(environments)
      .where(eq(environments.id, environmentId))
      .get();
    return result?.projectId ?? null;
  }

  private async getBlockProjectId(
    db: ReturnType<typeof createDb>,
    blockId: string,
  ): Promise<number | null> {
    const result = await db
      .select({ projectId: environments.projectId })
      .from(blocks)
      .innerJoin(environments, eq(environments.id, blocks.environmentId))
      .where(eq(blocks.id, blockId))
      .get();
    return result?.projectId ?? null;
  }
}
