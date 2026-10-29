import type { ApplyResult } from "@camox/api-contract/patrol";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { collectionRecords, sharedContents } from "../../schema";
import { fieldOf } from "../_shared/fields";
import { withoutLink } from "../_shared/links";
import type { ServiceContext } from "../_shared/service-context";
import { updateBlockContent } from "../blocks/service";
import { sharedPlacementId } from "../blocks/shared-content";
import { editRecord } from "../collections/service";
import { accessTo } from "../drafts/access";
import { holderOf } from "../drafts/content-checks";
import * as overlay from "../drafts/overlay";
import { draftIn, draftOf, type Draft } from "../drafts/scope";
import { defaultLocaleTag } from "../locales/default-locale";
import { updateRepeatableItemContent } from "../repeatable-items/service";
import { requestCheck } from "./checks";
import { dismiss, type FindingRow, resolveFinding } from "./findings";
import { PATROLLERS } from "./patrollers";
import { subjectKey, writeReport } from "./reports";
import { findings } from "./schema";

// What members do with a finding (ADR 0034): apply its suggested fix, which edits content as
// they would, in the draft the finding is in, or dismiss it for the whole project.

export const findingInput = z.object({ projectId: z.number(), findingId: z.number() });

/** An open finding of the project, or not found. */
const findingOf = Effect.fn("patrol.findingOf")(function* (
  ctx: ServiceContext,
  projectId: number,
  findingId: number,
) {
  const row = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(findings)
      .where(and(eq(findings.rowId, findingId), eq(findings.projectId, projectId)))
      .get(),
  );
  if (!row) return yield* new NotFoundError({ message: "This finding is no longer open" });
  return row;
});

const patrollerOf = (finding: FindingRow) =>
  PATROLLERS.find((patroller) => patroller.id === finding.patroller)!;

/**
 * Writes a field of a finding's content, as the member in the request: in the finding's locale,
 * through the write editors make. Shared content is written through a block placing it.
 */
const writeField = Effect.fn("patrol.writeField")(function* (
  ctx: ServiceContext,
  draft: Draft,
  finding: FindingRow,
  value: unknown,
  projectUuid: string,
) {
  const defaultTag = yield* defaultLocaleTag(ctx.db, draft.projectId);
  const inLocale = { ...ctx, ...(finding.locale !== defaultTag && { locale: finding.locale }) };
  const content = { [finding.field]: value };
  switch (finding.entity) {
    case "block":
      yield* updateBlockContent(inLocale, { id: finding.entityId, content });
      return;
    case "repeatableItem":
      yield* updateRepeatableItemContent(inLocale, { id: finding.entityId, content });
      return;
    case "sharedContent": {
      const shared = yield* overlay.get(ctx.db, draft, sharedContents, finding.entityId);
      const placement =
        shared &&
        (yield* sharedPlacementId(ctx.db, draft, {
          projectId: draft.projectId,
          type: shared.type,
        }));
      if (!placement) return yield* new NotFoundError();
      yield* updateBlockContent(inLocale, { id: placement, content });
      return;
    }
    case "record": {
      const record = yield* overlay.get(ctx.db, draft, collectionRecords, finding.entityId);
      if (!record) return yield* new NotFoundError();
      yield* editRecord(inLocale, {
        projectUuid,
        collectionId: record.collectionId,
        id: record.id,
        content,
      });
      return;
    }
    default:
      return yield* new InvalidInputError({ message: "This finding's content can't be edited" });
  }
});

/**
 * Applies a finding's suggested fix in the request's draft, as the member: only while its
 * content still holds what the finding is about. The finding is then resolved, and its patroller
 * reports the fix. Content that changed since is checked again instead: `applied` is false.
 * Live's findings are fixed in the Patrol Draft, not applied.
 */
export const applyFix = Effect.fn("patrol.applyFix")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof findingInput>,
) {
  const { projectId, findingId } = yield* decodeInput(findingInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { project: projectId }, "write");
  const draft = draftIn(scope);
  if (!draft) {
    return yield* new InvalidInputError({ message: "Live's findings are fixed in a draft" });
  }
  const finding = yield* findingOf(ctx, projectId, findingId);
  if (finding.draftId !== draft.id) return yield* new NotFoundError();
  if (!finding.fix) {
    return yield* new InvalidInputError({ message: "This finding suggests no fix" });
  }
  const patroller = patrollerOf(finding);
  const scoped = draftOf(draft);
  const holder = yield* holderOf(ctx, scoped, finding.locale, {
    entity: finding.entity,
    id: finding.entityId,
  });
  const field = holder && fieldOf(holder.schema, finding.field);
  const content = (holder?.content ?? {}) as Record<string, unknown>;
  const url = "url" in finding.about ? finding.about.url : null;
  const fixed = field && url !== null ? withoutLink(field, content[finding.field], url) : undefined;
  if (fixed === undefined) {
    yield* requestCheck(patroller, draft.id, 0);
    return { applied: false } satisfies ApplyResult;
  }
  yield* writeField(ctx, scoped, finding, fixed, project.uuid);
  yield* resolveFinding(ctx.db, finding);
  yield* writeReport(ctx.db, patroller, {
    projectId,
    draftId: draft.id,
    key: subjectKey(finding.entity, finding.entityId, finding.locale),
    summary: {
      kind: "structured",
      verb: "removedLink",
      subject: { entity: finding.entity, id: finding.entityId },
      locale: finding.locale,
    },
    outcome: "done",
  });
  return { applied: true } satisfies ApplyResult;
}, Effect.scoped);

/**
 * Dismisses what a finding is about, for the whole project, as the member in the request:
 * from a draft or from Live.
 */
export const dismissFinding = Effect.fn("patrol.dismissFinding")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof findingInput>,
) {
  const { projectId, findingId } = yield* decodeInput(findingInput, rawInput);
  const { user } = yield* accessTo(ctx, { project: projectId }, "member");
  const finding = yield* findingOf(ctx, projectId, findingId);
  yield* dismiss(ctx.db, finding, user!.id);
}, Effect.scoped);
