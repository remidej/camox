import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import { createDb } from "../db";
import { requestBlockSummary, runBlockSummaryJob } from "../domains/blocks/service";
import { runFileMetadataJob } from "../domains/files/service";
import { runPageSeoJob } from "../domains/pages/ai";
import { requestPageSeo } from "../domains/pages/service";
import { runRepeatableItemSummaryJob } from "../domains/repeatable-items/service";
import { announce } from "../lib/invalidation";
import { journaled } from "../lib/journal";
import { retryAiCall } from "../lib/retry-ai-call";
import { aiJobKey } from "../lib/schedule-ai-job";
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
    // What the job generated reaches the project's viewers like any write (ADR 0012).
    await Effect.runPromise(journaled(this.runJob(job), announce));

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
    const label = aiJobKey(job);

    if (entityTable === "blocks" && type === "summary") {
      const stale = yield* retryAiCall(label, (abortController) =>
        runBlockSummaryJob(db, apiKey, { entityId, draftId }, abortController),
      );
      // A changed summary changes its page's SEO.
      if (stale) yield* requestPageSeo(deps, stale.scope, stale.page, 15000);
    } else if (entityTable === "repeatableItems" && type === "summary") {
      const cascade = yield* retryAiCall(label, (abortController) =>
        runRepeatableItemSummaryJob(db, apiKey, { entityId, draftId }, abortController),
      );
      // A changed item summary changes its block's.
      if (cascade) {
        yield* requestBlockSummary(deps, cascade.scope, cascade.projectId, cascade.blockId, 5000);
      }
    } else if (entityTable === "files" && type === "fileMetadata") {
      yield* retryAiCall(label, (abortController) =>
        runFileMetadataJob(db, apiKey, { entityId, draftId }, abortController),
      );
    } else if (entityTable === "pages" && type === "seo") {
      yield* retryAiCall(label, (abortController) =>
        runPageSeoJob(db, apiKey, { entityId, draftId }, abortController),
      );
    }
  });
}
