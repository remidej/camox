import { and, eq, gte, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { type Change, Journal } from "../../lib/journal";
import { fieldOf } from "../_shared/fields";
import { linksOf } from "../_shared/links";
import { camoxContext } from "../drafts/camox-context";
import { draftOf } from "../drafts/scope";
import { holds, isAboutLink } from "./about";
import { holderOf } from "./content";
import { type CheckedSubject, isCheckedEntity } from "./findings";
import { linkChecker } from "./patrollers";
import { subjectKey, writeReport } from "./reports";
import { findings, reports } from "./schema";
import { patrolDraftOf } from "./scopes";

// The Link checker's reports of links fixed in a draft (ADR 0034): when a write leads a link it
// found broken elsewhere, a Link field to another url or rich text's link of the same text, it
// reports the link fixed; when the field no longer links at all, removed. Its findings in the draft count, and in the Patrol Draft, Live's,
// which its agent fixes there. Applying a finding's fix reports it on its own.

/** The subjects each draft a unit of work wrote content in, with its project. */
const writtenByDraft = (changes: readonly Change[]) => {
  const written = new Map<string, { projectId: number; subjects: CheckedSubject[] }>();
  for (const change of changes) {
    if (change.kind !== "localizedWrite" || change.draftId === null) continue;
    if (!isCheckedEntity(change.entity)) continue;
    const { entity, id, locale } = change;
    const known = written.get(change.draftId) ?? { projectId: change.projectId, subjects: [] };
    known.subjects.push({ entity, id, locale });
    written.set(change.draftId, known);
  }
  return written;
};

/** Whether the draft reported a fixed link in a subject since `since`: a fix is reported once. */
const reportedSince = Effect.fn("linkChecker.reportedSince")(function* (
  db: Database,
  draftId: string,
  key: string,
  since: number,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ rowId: reports.rowId })
      .from(reports)
      .where(
        and(
          eq(reports.draftId, draftId),
          eq(reports.patroller, linkChecker.id),
          eq(reports.key, key),
          gte(reports.at, since),
        ),
      )
      .get(),
  );
  return row !== undefined;
});

/**
 * Reports the links the unit of work fixed in each draft it wrote: a link the Link checker found
 * broken, in a subject written, that its field no longer links to. Runs once the work succeeded,
 * with its journal.
 */
export const reportFixedLinks = Effect.fn("linkChecker.reportFixedLinks")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const ctx = camoxContext(db);
  for (const [draftId, { projectId, subjects }] of writtenByDraft(changes)) {
    const patrolDraft = yield* patrolDraftOf(db, projectId);
    const scopes = [
      eq(findings.draftId, draftId),
      ...(patrolDraft?.id === draftId ? [isNull(findings.draftId)] : []),
    ];
    const open = yield* Effect.promise(() =>
      db
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.projectId, projectId),
            eq(findings.patroller, linkChecker.id),
            or(...scopes),
          ),
        ),
    );
    const draft = draftOf({ id: draftId, projectId });
    for (const finding of open) {
      const { about } = finding;
      const written = subjects.some(
        (subject) =>
          subject.entity === finding.entity &&
          subject.id === finding.entityId &&
          subject.locale === finding.locale,
      );
      if (!written || !isAboutLink(about)) continue;
      const holder = yield* holderOf(ctx, draft, finding.locale, {
        entity: finding.entity,
        id: finding.entityId,
      });
      if (!holder || holds(holder, finding)) continue;
      const key = subjectKey(finding.entity, finding.entityId, finding.locale);
      if (yield* reportedSince(db, draftId, key, finding.raisedAt)) continue;
      const field = fieldOf(holder.schema, finding.field);
      const value = (holder.content as Record<string, unknown> | null)?.[finding.field];
      // A Link field is one link; in rich text, the link is the one reading the same.
      const links = field ? linksOf(field, value) : [];
      const relinked =
        field?.kind === "Link" ? links.length > 0 : links.some((link) => link.text === about.text);
      yield* writeReport(db, linkChecker, {
        projectId,
        draftId,
        key,
        summary: {
          kind: "structured",
          verb: relinked ? "fixedLink" : "removedLink",
          subject: { entity: finding.entity, id: finding.entityId },
          locale: finding.locale,
        },
        outcome: "done",
      });
    }
  }
});
