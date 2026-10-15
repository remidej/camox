import { DRAFT_CREATE_HEADER, DRAFT_HEADER, DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";

/**
 * The draft the studio reads and writes (ADR 0011). The URL's `camox-draft` param names it;
 * without one the studio is on Live. Only block writes start a draft (#235): the first one on
 * Live mints an id and asks the API to create it, and the param lands in the URL once that write
 * succeeds. Edits fired before it settles share the same pending id so they land in one draft.
 */

const BLOCK_WRITES = new Set([
  "create",
  "updateContent",
  "updateSettings",
  "updatePosition",
  "delete",
  "deleteMany",
  "duplicate",
]);

let currentDraftId: string | null = null;
let pendingDraftId: string | null = null;
const listeners = new Set<(draftId: string) => void>();

export function readDraftFromUrl() {
  pendingDraftId = null;
  currentDraftId =
    typeof window === "undefined"
      ? null
      : new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM) || null;
}

export function getCurrentDraftId(): string | null {
  return currentDraftId;
}

/** Called once the first block write has created a draft and the studio switched into it. */
export function onDraftStarted(listener: (draftId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isBlockWrite(path: readonly string[]) {
  return path.length === 2 && path[0] === "blocks" && BLOCK_WRITES.has(path[1]);
}

/** Headers for an API call at `path`, and a callback to report whether the call succeeded. */
export function getDraftRequestHeaders(path: readonly string[]): {
  headers: Record<string, string>;
  settle: (ok: boolean) => void;
} {
  const noop = () => {};
  if (currentDraftId) return { headers: { [DRAFT_HEADER]: currentDraftId }, settle: noop };
  if (!isBlockWrite(path)) return { headers: {}, settle: noop };

  pendingDraftId ??= generateUuidv7();
  const draftId = pendingDraftId;
  return {
    headers: { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" },
    settle: (ok) => {
      if (currentDraftId || pendingDraftId !== draftId) return;
      if (!ok) {
        pendingDraftId = null;
        return;
      }
      enterDraft(draftId);
    },
  };
}

function enterDraft(draftId: string) {
  pendingDraftId = null;
  currentDraftId = draftId;
  const url = new URL(window.location.href);
  url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new window.CustomEvent("camox:navigation"));
  for (const listener of listeners) listener(draftId);
}
