import type { DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { decodeInput, InvalidInputError } from "../../lib/errors";
import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { listedChanges } from "../translations/review";
import { translatingLocales } from "../translations/service";
import { accessTo } from "./access";
import * as overlay from "./overlay";
import { peopleNamed, type Person, personOf } from "./people";
import { drafts } from "./schema";
import { draftIn, draftOf } from "./scope";
import { startDraft } from "./service";

// The drafts the studio's control lists and switches between (ADR 0011). An unnamed draft is
// labelled on the client from its creator and creation date; that label is never stored.

export type { Person };

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
  /** The tags of the locales the draft has pending translations into (ADR 0015). */
  translatingLocales: string[];
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

const summarize = Effect.fn("drafts.summarize")(function* (
  db: ServiceContext["db"],
  rows: (typeof drafts.$inferSelect)[],
) {
  const activity = yield* overlay.activityOf(
    db,
    rows.map((row) => row.id),
  );
  // As many changes as the draft's review lists, which leaves out what Camox wrote.
  const changeCounts = new Map<string, number>();
  for (const row of rows) {
    if (!activity.has(row.id)) continue;
    const scope = draftOf(row);
    const listed = yield* listedChanges(db, scope, yield* overlay.changesOf(db, scope));
    changeCounts.set(row.id, listed.length);
  }
  const people = yield* peopleNamed(
    db,
    rows.map((row) => row.createdBy),
  );
  const translating = yield* translatingLocales(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row): DraftSummary => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: personOf(people, row.createdBy),
    createdAt: row.createdAt,
    lastChangedAt: activity.get(row.id)?.lastChangedAt ?? null,
    changeCount: changeCounts.get(row.id) ?? 0,
    translatingLocales: translating.get(row.id) ?? [],
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
  const people = yield* peopleNamed(ctx.db, publisher ? [publisher] : []);
  return {
    live: {
      publishedBy: publisher ? personOf(people, publisher) : null,
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
  const { scope } = yield* Effect.scoped(accessTo(ctx, { project: projectId }, "member"));
  const draft = draftIn(scope);
  if (!draft) return yield* new InvalidInputError({ message: "Live isn't a draft: name one" });
  return yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, draft.id)).get(),
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
  yield* record(ctx.db, { kind: "drafts", projectId });
  const [summary] = yield* summarize(ctx.db, [{ ...draft, name: trimmed }]);
  return summary!;
});
