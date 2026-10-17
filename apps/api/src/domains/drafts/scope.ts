import type { DraftKind } from "@camox/api-contract/drafts";

/** A draft a request or job resolved to, checked against its project. */
export type Draft = { id: string; kind: DraftKind; projectId: number };

/** What a read sees: a draft over Live, or Live itself (`null`). */
export type DraftScope = Draft | null;

/**
 * Where a content write lands: a draft, or Live as a release writes it. Publishing a draft and
 * releases are Live's only writers (ADR 0006, ADR 0009), so no write targets Live otherwise.
 */
export type WriteTarget = Draft | typeof RELEASE;

/** The write target of a release, which writes Live and is published by no member. */
export const RELEASE = "release";

/** What a write target reads: its draft, or Live for a release. */
export function readScopeOf(target: WriteTarget): DraftScope {
  return target === RELEASE ? null : target;
}

/**
 * The draft a request names, before it is checked: a draft's id, where `create` asks for a
 * missing regular draft to be created with it, or the caller's development draft in the
 * project the request acts on (ADR 0011).
 */
export type DraftRequest = { id: string; create: boolean } | { development: true };
