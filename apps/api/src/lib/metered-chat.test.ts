import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AiUsageRecord } from "../domains/ai-usage/schema";
import { AiAttribution, type UsageLedger } from "./ai-usage";
import { openRouterModel } from "./open-router-model";

// What the model records of each call it makes to OpenRouter, from OpenRouter's own answers.

const attribution = {
  organizationId: "org-1",
  projectId: 7,
  draftId: "draft-1",
  initiator: "camox" as const,
  patroller: "seoManager" as const,
};

/** A ledger holding what it's given, once each record is known. */
function memoryLedger() {
  const pending: Promise<AiUsageRecord>[] = [];
  const ledger: UsageLedger = { record: (record) => void pending.push(Promise.resolve(record)) };
  return { ledger, records: () => Promise.all(pending) };
}

/**
 * OpenRouter answering every call with `content` and `usage`, as one completion, or as a stream
 * of chunks when the call asks for one.
 */
const openRouter =
  (content: string, usage: Record<string, unknown>) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { stream } = (await request.json()) as { stream?: boolean };
    const answer = {
      id: "gen-123",
      created: 1,
      model: "google/gemini-3.1-flash-lite",
      provider: "Google AI Studio",
    };
    if (!stream) {
      return Response.json({
        ...answer,
        object: "chat.completion",
        system_fingerprint: null,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage,
      });
    }
    const chunk = (fields: Record<string, unknown>) =>
      `data: ${JSON.stringify({ ...answer, object: "chat.completion.chunk", ...fields })}\n\n`;
    const events = [
      chunk({
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      }),
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      chunk({ choices: [], usage }),
      "data: [DONE]\n\n",
    ];
    return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
  };

const seoAnswer = JSON.stringify({ metaTitle: "Pricing", metaDescription: "Our plans" });

const usage = {
  prompt_tokens: 1000,
  completion_tokens: 50,
  total_tokens: 1050,
  prompt_tokens_details: { cached_tokens: 400 },
  completion_tokens_details: { reasoning_tokens: 10 },
};

const seoRequest = { locale: "en", fullPath: "/pricing", blocks: [] };

/** Asks for a page's SEO, attributed, recording into `ledger`, past every retry. */
async function pageSeo(ledger: UsageLedger) {
  const result = Effect.runPromise(
    openRouterModel("test-api-key", ledger)
      .pageSeo(seoRequest)
      .pipe(Effect.provideService(AiAttribution, attribution)),
  );
  const settled = result.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  return settled;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a call's AI usage record", () => {
  it("records what OpenRouter billed, with the call's attribution", async () => {
    vi.stubGlobal("fetch", vi.fn(openRouter(seoAnswer, { ...usage, cost: 0.000123 })));
    const { ledger, records } = memoryLedger();

    expect(await pageSeo(ledger)).toEqual({ metaTitle: "Pricing", metaDescription: "Our plans" });

    expect(await records()).toEqual([
      expect.objectContaining({
        ...attribution,
        key: "gen-123",
        generationId: "gen-123",
        purpose: "page_seo",
        model: "google/gemini-3.1-flash-lite",
        provider: "Google AI Studio",
        // Cached tokens are counted apart from the rest of the input.
        inputTokens: 600,
        cacheReadTokens: 400,
        outputTokens: 50,
        reasoningTokens: 10,
        costMicroUsd: 123,
        costSource: "billed",
        status: "ok",
      }),
    ]);
  });

  it("estimates the cost from the price list when OpenRouter reports none", async () => {
    vi.stubGlobal("fetch", vi.fn(openRouter(seoAnswer, usage)));
    const { ledger, records } = memoryLedger();

    await pageSeo(ledger);

    const [record] = await records();
    expect(record).toMatchObject({ costSource: "estimated" });
    expect(record!.costMicroUsd).toBeGreaterThan(0);
  });

  it("records every attempt of a call that fails, the last one as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(openRouter("not json", { ...usage, cost: 0.0001 })));
    const { ledger, records } = memoryLedger();

    expect(await pageSeo(ledger)).toMatchObject({ _tag: "AiCallError" });

    const recorded = await records();
    expect(recorded.map(({ status }) => status)).toEqual(["retried", "retried", "error"]);
    // A failed attempt still cost what OpenRouter billed for it.
    expect(recorded.every(({ costMicroUsd }) => costMicroUsd === 100)).toBe(true);
  });
});
