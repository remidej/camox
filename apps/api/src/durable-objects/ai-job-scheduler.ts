import { queryKeys } from "@camox/api-contract/query-keys";
import { DurableObject } from "cloudflare:workers";
import { eq, or } from "drizzle-orm";
import { Effect } from "effect";

import { createDb } from "../db";
import { executeBlockSummary } from "../domains/blocks/service";
import { executeFileMetadata } from "../domains/files/service";
import { executePageSeo } from "../domains/pages/ai";
import { executeRepeatableItemSummary } from "../domains/repeatable-items/service";
import { broadcastInvalidation } from "../lib/broadcast-invalidation";
import { retryAiCall } from "../lib/retry-ai-call";
import { blocks, files, layouts, pages, projects, repeatableItems } from "../schema";
import type { Bindings } from "../types";

type JobParams = {
  entityTable: string;
  entityId: number;
  type: string;
  delayMs: number;
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

    const { entityTable, entityId, type } = job;
    const label = `${entityTable}:${entityId}:${type}`;

    if (entityTable === "blocks" && type === "summary") {
      const seoStale = yield* retryAiCall(label, (abortController) =>
        executeBlockSummary(db, apiKey, entityId, abortController),
      );
      if (seoStale) {
        // Cascade: schedule page SEO regeneration
        const { scheduleAiJob } = yield* Effect.promise(() => import("../lib/schedule-ai-job"));
        this.ctx.waitUntil(
          scheduleAiJob(this.env.AI_JOB_SCHEDULER, {
            entityTable: "pages",
            entityId: seoStale.pageId,
            type: "seo",
            delayMs: 15000,
          }),
        );
      }

      // Broadcast block summary update
      const projectId = yield* Effect.promise(() => this.getBlockProjectId(db, entityId));
      if (projectId) {
        broadcastInvalidation({
          waitUntil: (p) => this.ctx.waitUntil(p),
          projectRoomNamespace: this.env.ProjectRoom,
          projectId,
          targets: [queryKeys.pages.getByPathAll, queryKeys.blocks.getUsageCounts],
        });
      }
    } else if (entityTable === "repeatableItems" && type === "summary") {
      const cascade = yield* retryAiCall(label, (abortController) =>
        executeRepeatableItemSummary(db, apiKey, entityId, abortController),
      );
      if (cascade) {
        // Cascade: schedule parent block summary regeneration
        const { scheduleAiJob } = yield* Effect.promise(() => import("../lib/schedule-ai-job"));
        this.ctx.waitUntil(
          scheduleAiJob(this.env.AI_JOB_SCHEDULER, {
            entityTable: "blocks",
            entityId: cascade.blockId,
            type: "summary",
            delayMs: 5000,
          }),
        );
      }

      // Broadcast repeatable item summary update
      const item = yield* Effect.promise(() =>
        db.select().from(repeatableItems).where(eq(repeatableItems.id, entityId)).get(),
      );
      if (item) {
        const projectId = yield* Effect.promise(() => this.getBlockProjectId(db, item.blockId));
        if (projectId) {
          broadcastInvalidation({
            waitUntil: (p) => this.ctx.waitUntil(p),
            projectRoomNamespace: this.env.ProjectRoom,
            projectId,
            targets: [queryKeys.pages.getByPathAll, queryKeys.blocks.getUsageCounts],
          });
        }
      }
    } else if (entityTable === "files" && type === "fileMetadata") {
      yield* retryAiCall(label, (abortController) =>
        executeFileMetadata(db, apiKey, entityId, abortController),
      );

      const file = yield* Effect.promise(() =>
        db.select().from(files).where(eq(files.id, entityId)).get(),
      );
      if (file?.projectId) {
        broadcastInvalidation({
          waitUntil: (p) => this.ctx.waitUntil(p),
          projectRoomNamespace: this.env.ProjectRoom,
          projectId: file.projectId,
          targets: [queryKeys.files.list, queryKeys.files.get(entityId)],
        });
      }
    } else if (entityTable === "pages" && type === "seo") {
      yield* retryAiCall(label, (abortController) =>
        executePageSeo(db, apiKey, entityId, abortController),
      );

      const page = yield* Effect.promise(() =>
        db.select().from(pages).where(eq(pages.id, entityId)).get(),
      );
      if (page) {
        broadcastInvalidation({
          waitUntil: (p) => this.ctx.waitUntil(p),
          projectRoomNamespace: this.env.ProjectRoom,
          projectId: page.projectId,
          targets: [queryKeys.pages.list, queryKeys.pages.getById(entityId)],
        });
      }
    }
  });

  private async getBlockProjectId(
    db: ReturnType<typeof createDb>,
    blockId: number,
  ): Promise<number | null> {
    const result = await db
      .select({ projectId: projects.id })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
      .where(eq(blocks.id, blockId))
      .get();
    return result?.projectId ?? null;
  }
}
