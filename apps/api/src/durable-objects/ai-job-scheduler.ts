import { DurableObject } from "cloudflare:workers";

import { createDb } from "../db";
import { executeBlockSummary } from "../features/blocks";
import { executeFileMetadata } from "../features/files";
import { executePageSeo } from "../features/pages";
import { executeRepeatableItemSummary } from "../features/repeatable-items";
import type { Bindings } from "../types";

type JobParams = {
  entityTable: string;
  entityId: number;
  type: string;
  delayMs: number;
};

export class AiJobScheduler extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/schedule") {
      const params: JobParams = await request.json();
      await this.ctx.storage.put("job", params);
      await this.ctx.storage.setAlarm(Date.now() + params.delayMs);
      return new Response(JSON.stringify({ scheduled: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const params = await this.ctx.storage.get<JobParams>("job");
    if (!params) return;

    await this.ctx.storage.delete("job");

    const db = createDb(this.env.DB);
    const apiKey = this.env.OPEN_ROUTER_API_KEY;

    const { entityTable, entityId, type } = params;

    if (entityTable === "blocks" && type === "summary") {
      const seoStale = await executeBlockSummary(db, apiKey, entityId);
      if (seoStale) {
        // Cascade: schedule page SEO regeneration
        const { scheduleAiJob } = await import("../lib/schedule-ai-job");
        scheduleAiJob(this.env.AI_JOB_SCHEDULER, {
          entityTable: "pages",
          entityId: seoStale.pageId,
          type: "seo",
          delayMs: 15000,
        });
      }
    } else if (entityTable === "repeatableItems" && type === "summary") {
      const cascade = await executeRepeatableItemSummary(db, apiKey, entityId);
      if (cascade) {
        // Cascade: schedule parent block summary regeneration
        const { scheduleAiJob } = await import("../lib/schedule-ai-job");
        scheduleAiJob(this.env.AI_JOB_SCHEDULER, {
          entityTable: "blocks",
          entityId: cascade.blockId,
          type: "summary",
          delayMs: 5000,
        });
      }
    } else if (entityTable === "files" && type === "fileMetadata") {
      await executeFileMetadata(db, apiKey, entityId);
    } else if (entityTable === "pages" && type === "seo") {
      await executePageSeo(db, apiKey, entityId);
    }
  }
}
