import type { DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, InvalidInputError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import * as overlay from "./overlay";
import { drafts } from "./schema";
import { resolveDraftScope, startDraft } from "./service";

// The drafts the studio's control lists and switches between (ADR 0011). An unnamed draft is
// labelled on the client from its creator and creation date; that label is never stored.

export type Person = { id: string; name: string };

export type DraftSummary = {
  id: string;
  kind: DraftKind;
  name: string | null;
  createdBy: Person;
  createdAt: number;
  /** When the draft last stored a change, or null while it stores nothing. */
  lastChangedAt: number | null;
  /** How many entities the draft changes: the length of its publish preview's changes. */
  changeCount: number;
};

export type DraftList = {
  /**
   * Who published Live last and when, or nulls when nothing was ever published. A release
   * publishes with no member (`release`), like a release's conflicts.
   */
  live: { publishedBy: Person | null; publishedAt: number | null; release: boolean };
  drafts: DraftSummary[];
};

export const listInput = z.object({ projectId: z.number() });
export const getInput = z.object({ projectId: z.number() });
export const renameInput = z.object({
  projectId: z.number(),
  name: z.string().max(200).nullable(),
});
export const createInput = z.object({
  projectId: z.number(),
  name: z.string().max(200).nullable().optional(),
});

const FORMER_MEMBER = "A former member";

const namesOf = Effect.fn("drafts.namesOf")(function* (db: ServiceContext["db"], ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? yield* Effect.promise(() =>
        db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique)),
      )
    : [];
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return (id: string): Person => ({ id, name: byId.get(id) ?? FORMER_MEMBER });
});

const summarize = Effect.fn("drafts.summarize")(function* (
  db: ServiceContext["db"],
  rows: (typeof drafts.$inferSelect)[],
) {
  const activity = yield* overlay.activityOf(
    db,
    rows.map((row) => row.id),
  );
  const person = yield* namesOf(
    db,
    rows.map((row) => row.createdBy),
  );
  return rows.map((row): DraftSummary => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: person(row.createdBy),
    createdAt: row.createdAt,
    lastChangedAt: activity.get(row.id)?.lastChangedAt ?? null,
    changeCount: activity.get(row.id)?.changeCount ?? 0,
  }));
});

/**
 * The project's open regular drafts, most recently changed first, with Live's latest publish.
 */
export const listDrafts = Effect.fn("drafts.list")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listInput>,
) {
  const { projectId } = yield* decodeInput(listInput, rawInput);
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(drafts)
      .where(
        // Development drafts stay out of the hosted studio: only the localhost studio
        // shows its owner's (ADR 0006).
        and(eq(drafts.projectId, projectId), eq(drafts.kind, "regular")),
      ),
  );
  const summaries = yield* summarize(ctx.db, rows);
  summaries.sort((a, b) => (b.lastChangedAt ?? b.createdAt) - (a.lastChangedAt ?? a.createdAt));

  const latest = yield* overlay.latestLivePublish(ctx.db, projectId);
  const publisher = latest?.publishedBy ?? null;
  const person = yield* namesOf(ctx.db, publisher ? [publisher] : []);
  return {
    live: {
      publishedBy: publisher ? person(publisher) : null,
      publishedAt: latest?.publishedAt ?? null,
      release: !!latest && !publisher,
    },
    drafts: summaries,
  } satisfies DraftList;
});

/**
 * Creates an empty regular draft in the project, by the caller and named or not, for surfaces
 * that open a draft before its first change. The studio starts drafts with its first write
 * instead (ADR 0011). A blank name leaves the draft unnamed, like renaming it to nothing.
 */
export const createDraft = Effect.fn("drafts.create")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createInput>,
) {
  const { projectId, name } = yield* decodeInput(createInput, rawInput);
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  const id = generateUuidv7();
  yield* startDraft(ctx.db, { id, projectId, createdBy: user.id, name: name?.trim() || null });
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    draftId: null,
    targets: [queryKeys.drafts.all],
  });
  const draft = yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, id)).get(),
  );
  const [summary] = yield* summarize(ctx.db, [draft!]);
  return summary!;
});

/** The draft the request names, which getting and renaming need. */
const requireDraft = Effect.fn("drafts.requireNamedDraft")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const scope = yield* resolveDraftScope(ctx, projectId);
  if (!scope) return yield* new InvalidInputError({ message: "Live isn't a draft: name one" });
  return yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, scope.id)).get(),
  ).pipe(Effect.map((row) => row!));
});

/** The draft the request names, summarized like a listed draft. */
export const getDraft = Effect.fn("drafts.get")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getInput>,
) {
  const { projectId } = yield* decodeInput(getInput, rawInput);
  const draft = yield* requireDraft(ctx, projectId);
  const [summary] = yield* summarize(ctx.db, [draft]);
  return summary!;
});

/**
 * Names the regular draft the request names, for every member. Any member can rename any
 * regular draft. A blank name clears it, so the draft shows its computed label again.
 */
export const renameDraft = Effect.fn("drafts.rename")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof renameInput>,
) {
  const { projectId, name } = yield* decodeInput(renameInput, rawInput);
  const draft = yield* requireDraft(ctx, projectId);
  if (draft.kind !== "regular") {
    return yield* new InvalidInputError({ message: "Only a regular draft has a name" });
  }
  const trimmed = name?.trim() || null;
  yield* Effect.promise(() =>
    ctx.db.update(drafts).set({ name: trimmed }).where(eq(drafts.id, draft.id)),
  );
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    draftId: null,
    targets: [queryKeys.drafts.all],
  });
  const [summary] = yield* summarize(ctx.db, [{ ...draft, name: trimmed }]);
  return summary!;
});
