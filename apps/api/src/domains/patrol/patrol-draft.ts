import { CAMOX_ACTOR } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import type { FindingView } from "@camox/api-contract/patrol";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { Bindings } from "../../types";
import { findingLine } from "../drafts/publish";
import { startDraft } from "../drafts/service";
import type { RaisedFinding } from "./findings";
import type { Patroller } from "./patrollers";
import { liveFindings } from "./read";
import { patrolDraftOf } from "./scopes";

// The Patrol Draft (ADR 0034): the one draft Camox opens to fix what its patrollers find on Live.
// A Live run's new findings open it, started by Camox, and start Camox's agent there with a Brief
// listing them; later runs send theirs into its thread. The agent fixes what it can tell how to,
// and asks in the thread about the rest. Members publish it: Camox never does.

/** The name of the draft Camox opens to fix Live's findings. */
export const PATROL_DRAFT_NAME = "Patrol";

/** What Camox asks of its agent in the Patrol Draft, after the findings it lists. */
const REQUEST =
  "Fix them in this draft: apply the fix a finding suggests with applyFindingFix (listFindings " +
  "lists them), and repair or remove a link that doesn't work when the website tells you how. " +
  "Ask the editors here about the rest, rather than guess a URL or a wording. You can't dismiss " +
  "a finding, and you don't publish: members review this draft and publish it.";

/** Camox's message telling its agent what a patroller's Live run found that's new. */
const briefOf = (patroller: Patroller, found: readonly FindingView[]) =>
  [
    `The ${patroller.role} found ${found.length === 1 ? "a new problem" : `${found.length} new problems`} on Live:`,
    ...found.map((finding) => `- ${findingLine(finding)}.`),
    "",
    REQUEST,
  ].join("\n");

/** Whether a finding view is the one raised as `raised`. */
const isRaised = (view: FindingView, raised: RaisedFinding) =>
  view.subject.entity === raised.entity &&
  view.subject.id === raised.id &&
  view.locale === raised.locale &&
  view.field === raised.field &&
  JSON.stringify(view.about) === JSON.stringify(raised.about);

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

/**
 * Hands the findings a patroller's Live run raised that are new to the Patrol Draft: opens it
 * when none is open, then sends Camox's message listing them into its thread, which starts the
 * agent there, or joins its run going. Nothing new, nothing sent. A thread that can't take it is
 * logged: the findings stay open on Live.
 */
export const toPatrolDraft = Effect.fn("patrol.toPatrolDraft")(function* (
  db: Database,
  patroller: Patroller,
  projectId: number,
  opened: readonly RaisedFinding[],
) {
  if (opened.length === 0) return;
  const views = yield* liveFindings(db, projectId);
  const found = views.filter(
    (view) => view.patroller === patroller.id && opened.some((raised) => isRaised(view, raised)),
  );
  if (found.length === 0) return;
  const draft = yield* openPatrolDraft(db, projectId);
  const { threadId } = draft;
  if (!threadId) return yield* Effect.die(new Error("The Patrol Draft has no thread"));
  yield* Effect.tryPromise(() =>
    (env as Bindings).THREAD.getByName(threadId).send({
      identity: { projectId, draftId: draft.id, ownerId: null },
      message: {
        operationId: generateUuidv7(),
        text: briefOf(patroller, found),
        from: { kind: "camox" },
      },
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.logError(`[patrol] the Patrol Draft's thread didn't take the findings`, error),
    ),
  );
});
