import type { ChatMiddleware, FetchWrapper, UsageInfo } from "@tanstack/ai";
import { Effect, Exit } from "effect";

import type { AiPurpose, AiUsageRecord } from "../domains/ai-usage/schema";
import { estimatedCostMicroUsd } from "./ai-prices";
import { AiAttribution, attributionColumns, type UsageLedger } from "./ai-usage";
import type { AiCallAttempt } from "./retry-ai-call";

/** What a call told about itself as it ran, for its AI usage record. */
type Seen = {
  usage?: UsageInfo;
  generationId?: string;
  /** The provider OpenRouter routed the call to, read from its response. */
  provider?: Promise<string | undefined>;
};

/** What `chat()` is given to meter a call. */
export type MeteringOptions = { middleware: ChatMiddleware[]; wrapFetch: FetchWrapper };

/** The provider an OpenRouter response names, a JSON body or a stream of events alike. */
const providerIn = (body: string) => /"provider"\s*:\s*"([^"]+)"/.exec(body)?.[1];

/** Tells `seen` what the call reports: its usage, its generation id and its provider. */
const metering = (seen: Seen): MeteringOptions => ({
  middleware: [
    {
      name: "ai-usage",
      onChunk: (_ctx, chunk) => {
        if (chunk.type === "RUN_FINISHED" && chunk.responseId) seen.generationId = chunk.responseId;
      },
      onUsage: (_ctx, usage) => {
        seen.usage = usage;
      },
    },
  ],
  wrapFetch: (next) => async (input, init) => {
    const response = await next(input, init);
    seen.provider = response
      .clone()
      .text()
      .then(providerIn)
      .catch(() => undefined);
    return response;
  },
});

/** The record of a call that settled: what it cost, from what it reported. */
const recordOf = async (
  call: { purpose: AiPurpose; model: string },
  seen: Seen,
  base: Pick<AiUsageRecord, "status" | "latencyMs" | "createdAt"> &
    ReturnType<typeof attributionColumns>,
): Promise<AiUsageRecord> => {
  const usage = seen.usage;
  const cacheRead = usage?.promptTokensDetails?.cachedTokens ?? 0;
  const cacheWrite = usage?.promptTokensDetails?.cacheWriteTokens ?? 0;
  const tokens = usage && {
    // OpenRouter counts cached tokens among the prompt's.
    input: Math.max(0, usage.promptTokens - cacheRead - cacheWrite),
    output: usage.completionTokens,
    cacheRead,
    cacheWrite,
  };
  const billed = usage?.cost === undefined ? null : Math.round(usage.cost * 1_000_000);
  const estimated = billed === null && tokens ? estimatedCostMicroUsd(call.model, tokens) : null;
  return {
    ...base,
    // A call without a generation id never reached a model, and is only ever recorded once.
    key: seen.generationId ?? crypto.randomUUID(),
    purpose: call.purpose,
    model: call.model,
    provider: (await seen.provider) ?? null,
    generationId: seen.generationId ?? null,
    inputTokens: tokens?.input ?? null,
    outputTokens: tokens?.output ?? null,
    cacheReadTokens: tokens?.cacheRead ?? null,
    cacheWriteTokens: tokens?.cacheWrite ?? null,
    reasoningTokens: usage?.completionTokensDetails?.reasoningTokens ?? null,
    costMicroUsd: billed ?? estimated,
    costSource: billed !== null ? "billed" : estimated !== null ? "estimated" : null,
  };
};

/**
 * Runs one attempt of a model call with `chat()`, given what meters it, and records what it cost
 * in the ledger once it settles, whether it succeeded, failed or timed out: one AI usage record
 * per attempt, attributed as `AiAttribution` says. The cost is OpenRouter's, or the price list's
 * when it reports none. Recording never holds up nor fails the call.
 */
export const meteredChat = <A>(
  ledger: UsageLedger,
  call: { purpose: AiPurpose; model: string; attempt: AiCallAttempt },
  run: (metering: MeteringOptions) => Promise<A>,
) =>
  Effect.gen(function* () {
    const attribution = yield* AiAttribution;
    const seen: Seen = {};
    const startedAt = Date.now();
    return yield* Effect.promise(() => run(metering(seen))).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() =>
          ledger.record(
            recordOf(call, seen, {
              ...attributionColumns(attribution),
              status: Exit.isSuccess(exit) ? "ok" : call.attempt.last ? "error" : "retried",
              latencyMs: Date.now() - startedAt,
              createdAt: startedAt,
            }),
          ),
        ),
      ),
    );
  });
