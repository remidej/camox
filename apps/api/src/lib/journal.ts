import type { EndedDraft } from "@camox/api-contract/drafts";
import { Context, Effect } from "effect";

import type { Database } from "../db";
import type { EntityKind } from "../domains/drafts/overlay";

// The journal of a unit of work: one request, upload, or AI job. Every write says what it
// changed by recording it here; nothing else decides what realtime messages a write sends. The
// overlay records each content entity it writes, so content writes record nothing themselves.
// `runService` provides the journal and, once the work succeeded, turns it into messages for the
// project rooms (`invalidation.ts`). Work that failed sends nothing.

/** One thing a unit of work changed, said in domain terms rather than in query keys. */
export type Change =
  /**
   * A content entity the drafts overlay wrote: in a draft, or in Live (`draftId` null) when a
   * release or a publish wrote it. `row` is the entity as written, or as it was before a
   * deletion, when the writer has it.
   */
  | {
      kind: "content";
      entity: EntityKind;
      id: string;
      projectId: number;
      draftId: string | null;
      change: "created" | "changed" | "deleted";
      row?: Record<string, unknown>;
      /** The columns an update set: a rename moves a page off the path it was read under. */
      columns?: string[];
    }
  /**
   * A localized entity a draft, or a release on Live (`draftId` null), wrote, in the locale it
   * was written in, recorded by the overlay beside its content change. Once the work succeeded,
   * a write in the default locale is translated into the draft's other locales, or a release's
   * into Live's in Camox's catch-up draft (ADR 0017). It shows nowhere by itself.
   */
  | {
      kind: "localizedWrite";
      entity: EntityKind;
      id: string;
      projectId: number;
      draftId: string | null;
      locale: string;
    }
  /** A draft's pending translations, which its locales show as translating (ADR 0015). */
  | { kind: "translations"; projectId: number; draftId: string }
  /** A generated value of an entity (ADR 0012): it shows with the entity, but never changes a draft. */
  | { kind: "generated"; entity: EntityKind; id: string; projectId: number; draftId: string | null }
  /** A draft's overview: requested, written, or failed. It shows in the draft's review only. */
  | { kind: "overview"; projectId: number; draftId: string }
  /** Definitions synced into Live by a release, or into a development draft by dev mode. */
  | { kind: "definitions"; projectId: number; draftId: string | null }
  /** A draft was started, renamed, or emptied: what the drafts list shows changed. */
  | { kind: "drafts"; projectId: number }
  /** A draft was published or discarded, by someone. */
  | { kind: "ended"; projectId: number; ended: EndedDraft }
  /** The project's own settings, the same in every draft. */
  | { kind: "project"; projectId: number };

/** What a unit of work recorded, and the database it wrote to, once it wrote. */
type Recorded = { db?: Database; changes: Change[] };

/**
 * The journal a write records into. Every effect that writes requires it, so work that writes
 * can't run anywhere that doesn't announce what it changed.
 */
export class Journal extends Context.Service<Journal, Recorded>()("camox/Journal") {}

/** Records a change, written to `db`, which is read again to tell where the change shows. */
export const record = (db: Database, change: Change) =>
  Journal.useSync((journal) => {
    journal.db = db;
    journal.changes.push(change);
  });

/**
 * Runs `effect` with a fresh journal and, once it succeeded, hands what it recorded to
 * `announce`. A failure announces nothing.
 */
export const journaled = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  announce: (db: Database, changes: readonly Change[]) => Effect.Effect<void>,
): Effect.Effect<A, E, Exclude<R, Journal>> =>
  Effect.suspend(() => {
    const journal: Recorded = { changes: [] };
    return effect.pipe(
      Effect.provideService(Journal, journal),
      Effect.tap(() => (journal.db ? announce(journal.db, journal.changes) : Effect.void)),
    );
  });
