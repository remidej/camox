import { generateUuidv7 } from "@camox/api-contract/ids";
import type { PatrollerId } from "@camox/api-contract/patrol";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** What an AI usage record paid for. */
export type AiPurpose =
  | "agent_step"
  | "compaction"
  | "summary"
  | "page_seo"
  | "file_metadata"
  | "translation"
  | "merge"
  | "draft_overview"
  | "web_search"
  | "web_fetch"
  | "sandbox"
  | "build";

/**
 * Who started the work: a member, the agent, or Camox itself (patrollers, catch-up drafts).
 * Billing isn't decided, but each must be told apart.
 */
export type AiInitiator = "member" | "agent" | "camox";

/** The kind of tools an agent step called. */
export type AiToolKind = "content" | "code" | "web" | "reply";

/** `billed`: the cost OpenRouter charged. `estimated`: computed from the price list. */
export type AiCostSource = "billed" | "estimated";

/** `retried`: the call failed and was tried again. `error`: it failed for good. */
export type AiCallStatus = "ok" | "error" | "retried";

/**
 * AI usage records: what one AI call, or the sandbox compute around it, cost, appended once and
 * never changed. The source of truth for what Camox spends on AI; PostHog only gets a copy (ADR
 * 0031). No foreign keys: records outlive the organizations, projects, drafts and threads they
 * name. Neither prompts nor outputs are kept.
 */
export const aiUsageRecords = sqliteTable(
  "ai_usage_records",
  {
    id: text().primaryKey().$defaultFn(generateUuidv7),
    // One per call, so recording a call again, as a replay does, records nothing: OpenRouter's
    // generation id, or another id the call has for good.
    key: text().notNull(),

    // Who and where.
    organizationId: text("organization_id"),
    projectId: int("project_id"),
    // Null on Live.
    draftId: text("draft_id"),
    threadId: text("thread_id"),
    // Set only when a member started the work.
    memberId: text("member_id"),
    initiator: text().notNull().$type<AiInitiator>(),
    patroller: text().$type<PatrollerId>(),

    purpose: text().notNull().$type<AiPurpose>(),

    // Agent steps: Camox's turn (Pi's run), the step in it, and the tools it called.
    turnId: text("turn_id"),
    step: int(),
    toolCalls: text("tool_calls", { mode: "json" }).$type<string[]>(),
    toolKind: text("tool_kind").$type<AiToolKind>(),
    // The size of each tool result, in bytes, in call order.
    toolResultBytes: text("tool_result_bytes", { mode: "json" }).$type<number[]>(),

    // The model asked for, the provider OpenRouter routed the call to, and its generation id.
    model: text(),
    provider: text(),
    generationId: text("generation_id"),

    inputTokens: int("input_tokens"),
    outputTokens: int("output_tokens"),
    cacheReadTokens: int("cache_read_tokens"),
    cacheWriteTokens: int("cache_write_tokens"),
    reasoningTokens: int("reasoning_tokens"),
    // In millionths of a US dollar, as it was when the call was made. Null when unknown.
    costMicroUsd: int("cost_micro_usd"),
    costSource: text("cost_source").$type<AiCostSource>(),

    status: text().notNull().$type<AiCallStatus>(),
    latencyMs: int("latency_ms"),
    createdAt: int("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_usage_records_key_idx").on(table.key),
    index("ai_usage_records_organization_idx").on(table.organizationId, table.createdAt),
    index("ai_usage_records_project_idx").on(table.projectId, table.createdAt),
  ],
);

export type AiUsageRecord = typeof aiUsageRecords.$inferInsert;
