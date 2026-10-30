import { CAMOX_ACTOR } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { type FindingView, findingSentence, type PatrollerId } from "@camox/api-contract/patrol";
import { env } from "cloudflare:workers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { Bindings } from "../../types";
import { chunksOf } from "../content/chunks";
import { camoxContext } from "../drafts/camox-context";
import { draftOf } from "../drafts/scope";
import { startDraft } from "../drafts/service";
import type { TurnOutcome } from "../threads/turn-end";
import { heldIn } from "./fixes";
import { PATROLLERS } from "./patrollers";
import { liveFindings } from "./read";
import { findings } from "./schema";
import { patrolDraftOf } from "./scopes";

// The Patrol Draft (ADR 0034): the one draft Camox opens to fix what its patrollers find on Live.
// A Live run's new findings open it, started by Camox, and start Camox's agent there with a Brief
// listing them; later runs send theirs into its thread. A finding is handed to the agent once its
// thread took it: until then, each run sends it again. The agent fixes what it can tell how to,
// and asks in the thread about the rest. Members publish it: Camox never does.

/** The name of the draft Camox opens to fix Live's findings. */
export const PATROL_DRAFT_NAME = "Patrol";

/** How long a run waits for the agent's turn on what it handed, to tell members what it left. */
export const AGENT_TURN_WAIT_MS = 5 * 60_000;

/** What Camox asks of its agent in the Patrol Draft, after the findings it lists. */
const REQUEST =
  "Fix them in this draft: apply the fix a finding suggests with applyFindingFix (listFindings " +
  "lists them), and repair or remove a link that doesn't work when the website tells you how. " +
  "Ask the editors here about the rest, rather than guess a URL or a wording. You can't dismiss " +
  "a finding, and you don't publish: members review this draft and publish it.";

/** A Live finding, with the patroller that raised it. */
export type LiveFinding = FindingView & { patroller: PatrollerId };

/** How many new problems there are, as a sentence says it: "a new problem", "3 new problems". */
export const newProblems = (count: number) =>
  count === 1 ? "a new problem" : `${count} new problems`;

/** Findings by the patroller that raised them, in the registry's order. */
export const byPatroller = (found: readonly LiveFinding[]) =>
  PATROLLERS.flatMap((patroller) => {
    const its = found.filter((finding) => finding.patroller === patroller.id);
    return its.length === 0 ? [] : [{ patroller, found: its }];
  });

/** Camox's message telling its agent what Live's patrols found that's new. */
const briefOf = (found: readonly LiveFinding[]) =>
  [
    ...byPatroller(found).flatMap(({ patroller, found: its }) => [
      `The ${patroller.role} found ${newProblems(its.length)} on Live:`,
      ...its.map((finding) => `- ${findingSentence(finding)}.`),
      "",
    ]),
    REQUEST,
  ].join("\n");

/**
 * The project's open Patrol Draft, opened now, started by Camox, when there's none. Runs racing
 * to open one get the same: the database keeps one open per project.
 */
const openPatrolDraft = Effect.fn("patrol.openPatrolDraft")(function* (
  db: Database,
  projectId: number,
) {
  const existing = yield* patrolDraftOf(db, projectId);
  if (existing) return existing;
  yield* startDraft(db, {
    id: generateUuidv7(),
    projectId,
    createdBy: CAMOX_ACTOR,
    name: PATROL_DRAFT_NAME,
    threadId: generateUuidv7(),
    purpose: "patrol",
  });
  const opened = yield* patrolDraftOf(db, projectId);
  if (!opened) return yield* Effect.die(new Error("No Patrol Draft after opening one"));
  return opened;
});

/** Live's open findings not handed to the Patrol Draft yet, by their ids. */
const unhandedIds = Effect.fn("patrol.unhandedIds")(function* (db: Database, projectId: number) {
  const rows = yield* Effect.promise(() =>
    db
      .select({ rowId: findings.rowId })
      .from(findings)
      .where(
        and(eq(findings.projectId, projectId), isNull(findings.draftId), isNull(findings.handedAt)),
      ),
  );
  return new Set(rows.map((row) => row.rowId));
});

/**
 * Hands Live's open findings that weren't handed yet to the Patrol Draft: opens it when none is
 * open, then sends Camox's message listing them into its thread, which starts the agent there, or
 * joins its run going. Nothing to hand, nothing sent. A thread that can't take it is logged, and
 * its findings stay to hand: the next run sends them. Returns the Patrol Draft, the message's
 * operation id and the findings it handed, or null when it handed none.
 */
export const toPatrolDraft = Effect.fn("patrol.toPatrolDraft")(function* (
  db: Database,
  projectId: number,
) {
  const unhanded = yield* unhandedIds(db, projectId);
  if (unhanded.size === 0) return null;
  const found = (yield* liveFindings(db, projectId)).filter((view) => unhanded.has(view.id));
  if (found.length === 0) return null;
  const draft = yield* openPatrolDraft(db, projectId);
  const { threadId } = draft;
  if (!threadId) return yield* Effect.die(new Error("The Patrol Draft has no thread"));
  const operationId = generateUuidv7();
  const sent = yield* Effect.tryPromise(() =>
    (env as Bindings).THREAD.getByName(threadId).send({
      identity: { projectId, draftId: draft.id, ownerId: null },
      message: { operationId, text: briefOf(found), from: { kind: "camox" } },
    }),
  ).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.as(
        Effect.logError(`[patrol] the Patrol Draft's thread didn't take the findings`, error),
        false,
      ),
    ),
  );
  if (!sent) return null;
  const handedAt = Date.now();
  yield* Effect.promise(() =>
    Promise.all(
      chunksOf(found.map((finding) => finding.id)).map((ids) =>
        db.update(findings).set({ handedAt }).where(inArray(findings.rowId, ids)),
      ),
    ),
  );
  return { draft, threadId, operationId, found };
});

/** What a Patrol Draft's agent was handed: the run's `toPatrolDraft`. */
export type Handed = NonNullable<Effect.Success<ReturnType<typeof toPatrolDraft>>>;

/**
 * How many findings the agent left for a person once its turn on them ended: those the Patrol
 * Draft still holds, which it didn't fix there. Null when the turn didn't end in time, or the
 * draft ended meanwhile: what it leaves isn't known yet.
 */
export const leftByAgent = Effect.fn("patrol.leftByAgent")(function* (
  db: Database,
  { draft, threadId, operationId, found }: Handed,
) {
  const turn = yield* Effect.promise((): Promise<TurnOutcome> =>
    (env as Bindings).THREAD.getByName(threadId)
      .turnOf(operationId, AGENT_TURN_WAIT_MS)
      // An object restarting mid-wait, as a deploy does, drops the wait, not the turn.
      .catch((error: unknown): TurnOutcome => {
        console.warn("[patrol] stopped waiting on the Patrol Draft's turn", error);
        return { turn: "working" };
      }),
  );
  if (turn.turn === "working" || turn.turn === "threadEnded") return null;
  if (!(yield* patrolDraftOf(db, draft.projectId))) return null;
  return (yield* heldIn(camoxContext(db), draftOf(draft), found)).length;
});
