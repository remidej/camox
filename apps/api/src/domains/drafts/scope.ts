import type { DraftKind } from "@camox/api-contract/drafts";

/** The draft a request resolved to. `null` means the request reads and writes Live. */
export type DraftScope = { id: string; kind: DraftKind; projectId: number } | null;
