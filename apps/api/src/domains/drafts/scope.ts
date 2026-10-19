import type { DraftKind } from "@camox/api-contract/drafts";

/**
 * A draft a request or job resolved to, checked against its project. As a scope, it reads and
 * writes content in `locale`, a locale's tag, or without one in the project's default locale
 * (ADR 0015). Publishing and discarding act on every locale.
 */
export type Draft = { id: string; kind: DraftKind; projectId: number; locale?: string };

/** The draft a drafts row, or anything shaped like one, is: in the default locale. */
export function draftOf(row: Draft): Draft {
  return { id: row.id, kind: row.kind, projectId: row.projectId };
}

/** What a read sees: a draft over Live, or Live itself (`null`), in the default locale. */
export type DraftScope = Draft | null;

/** Live, read in a locale named by its tag. */
export type LiveInLocale = { live: true; locale: string };

/**
 * What the draft overlay reads: a draft scope, or Live in a named locale. A scope naming no
 * locale reads the project's default locale.
 */
export type ReadScope = DraftScope | LiveInLocale;

/** The draft a scope reads over Live, or null when it reads Live itself. */
export function draftIn(scope: ReadScope): Draft | null {
  return scope && "id" in scope ? scope : null;
}

/** A draft read and written in a locale named by its tag. */
export type DraftInLocale = Draft & { locale: string };

/** The scope reading what `scope` reads, in another locale named by its tag. */
export function inLocale(scope: Draft, locale: string): DraftInLocale;
export function inLocale(scope: ReadScope, locale: string): Draft | LiveInLocale;
export function inLocale(scope: ReadScope, locale: string): Draft | LiveInLocale {
  const draft = draftIn(scope);
  return draft ? { ...draft, locale } : { live: true, locale };
}

/** The scope reading what `scope` reads, in the project's default locale. */
export function inDefaultLocale(scope: ReadScope): DraftScope {
  const draft = draftIn(scope);
  return draft && draftOf(draft);
}

/**
 * Where a content write lands: a draft, or Live as a release writes it. Publishing a draft and
 * releases are Live's only writers (ADR 0006, ADR 0009), so no write targets Live otherwise. A
 * release writes in the default locale.
 */
export type WriteTarget = Draft | typeof RELEASE;

/** The write target of a release, which writes Live and is published by no member. */
export const RELEASE = "release";

/** What a write target reads: its draft, or Live for a release. */
export function readScopeOf(target: WriteTarget): Draft | null {
  return target === RELEASE ? null : target;
}

/**
 * The draft a request names, before it is checked: a draft's id, where `create` asks for a
 * missing regular draft to be created with it, or the caller's development draft in the
 * project the request acts on (ADR 0011).
 */
export type DraftRequest = { id: string; create: boolean } | { development: true };
