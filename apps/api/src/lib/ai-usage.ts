import type { PatrollerId } from "@camox/api-contract/patrol";
import { eq } from "drizzle-orm";
import { Context, Effect, Schedule } from "effect";

import type { Database } from "../db";
import { AGENT_CLIENT, type ServiceContext } from "../domains/_shared/service-context";
import { type AiInitiator, type AiUsageRecord, aiUsageRecords } from "../domains/ai-usage/schema";
import { draftIn, type ReadScope } from "../domains/drafts/scope";
import { projects } from "../domains/projects/schema";

/**
 * Who an AI call is for and who started it, which every AI usage record of the call names. The
 * code asking for the work provides it: a job, or a request generating a value now.
 */
export type AiAttribution = {
  organizationId: string | null;
  projectId: number | null;
  /** Null on Live. */
  draftId: string | null;
  initiator: AiInitiator;
  /** The patroller doing the work, when one does it. */
  patroller?: PatrollerId | null;
  /** The member who started the work: their user id. */
  memberId?: string | null;
  threadId?: string | null;
};

/**
 * The attribution of the AI calls made within an effect, or undefined where nothing provided
 * one: their records then name no project.
 */
export const AiAttribution = Context.Reference<AiAttribution | undefined>("camox/AiAttribution", {
  defaultValue: () => undefined,
});

/**
 * Attributes the AI calls an effect makes to Camox working on a project, in a draft or on Live
 * (`draftId` null), as a patroller or on its own. For `pipe`.
 */
export const attributedToCamox =
  (
    db: Database,
    where: { projectId: number; draftId: string | null; patroller: PatrollerId | null },
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.promise(() =>
      db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(eq(projects.id, where.projectId))
        .get(),
    ).pipe(
      Effect.flatMap((project) =>
        Effect.provideService(effect, AiAttribution, {
          organizationId: project?.organizationId ?? null,
          projectId: where.projectId,
          draftId: where.draftId,
          initiator: "camox",
          patroller: where.patroller,
        }),
      ),
    );

/**
 * Attributes the AI calls an effect makes to the request asking for them in a project's scope:
 * to its member, or to the agent when it's the agent's request. For `pipe`.
 */
export const attributedToRequest =
  (
    ctx: Pick<ServiceContext, "user" | "client">,
    project: { id: number; organizationId: string },
    scope: ReadScope,
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) => {
    const agent = ctx.client === AGENT_CLIENT;
    return Effect.provideService(effect, AiAttribution, {
      organizationId: project.organizationId,
      projectId: project.id,
      draftId: draftIn(scope)?.id ?? null,
      initiator: agent ? "agent" : "member",
      memberId: agent ? null : (ctx.user?.id ?? null),
    });
  };

/**
 * Where AI usage records go. Recording never blocks nor fails the work it records: a record is
 * written in the background, once it's known, and a failed write is retried.
 */
export type UsageLedger = {
  readonly record: (record: AiUsageRecord | PromiseLike<AiUsageRecord>) => void;
};

/** Two retries after the first attempt, ~1s then ~2s apart (jittered). */
const WRITE_RETRIES = Schedule.max([
  Schedule.exponential("1 second").pipe(Schedule.jittered),
  Schedule.recurs(2),
]);

/**
 * Writes a record, unless one of the same key is there already, as when a call is recorded
 * again. Logs a write that failed for good.
 */
export const writeUsageRecord = (db: Database, record: AiUsageRecord) =>
  Effect.tryPromise(() =>
    db.insert(aiUsageRecords).values(record).onConflictDoNothing({ target: aiUsageRecords.key }),
  ).pipe(
    Effect.retry(WRITE_RETRIES),
    Effect.catch((error) =>
      Effect.logError(`[ai-usage] couldn't record ${record.purpose} ${record.key}`, error),
    ),
    Effect.asVoid,
  );

/** The ledger in D1, written while `waitUntil` keeps the request or alarm alive. */
export const d1Ledger = (
  db: Database,
  waitUntil: (promise: Promise<unknown>) => void,
): UsageLedger => ({
  record: (record) =>
    waitUntil(
      Promise.resolve(record)
        .then((known) => Effect.runPromise(writeUsageRecord(db, known)))
        .catch((error: unknown) => console.error("[ai-usage] couldn't record a call", error)),
    ),
});

/** A ledger that drops every record, where nothing is recorded. */
export const noLedger: UsageLedger = { record: () => {} };

/** The attribution columns of a record. */
export const attributionColumns = (attribution: AiAttribution | undefined) => ({
  organizationId: attribution?.organizationId ?? null,
  projectId: attribution?.projectId ?? null,
  draftId: attribution?.draftId ?? null,
  threadId: attribution?.threadId ?? null,
  memberId: attribution?.memberId ?? null,
  initiator: attribution?.initiator ?? "camox",
  patroller: attribution?.patroller ?? null,
});
