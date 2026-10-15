import type { DraftKind } from "@camox/api-contract/drafts";

/** The draft a request resolved to. `null` means the request reads and writes Live. */
export type DraftScope = { id: string; kind: DraftKind; projectId: number } | null;

/**
 * The draft a request names, before it is checked: `create` asks for a missing regular draft
 * to be created with this id (ADR 0011).
 */
export type DraftRequest = { id: string; create: boolean };
