import type { Router } from "@camox/api-contract";
import { DRAFT_CREATE_HEADER, DRAFT_HEADER, DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";

/**
 * The draft the studio reads and writes (ADR 0011). The URL's `camox-draft` param names it;
 * without one the studio is on Live. Only block writes start a draft (#235): the first one on
 * Live mints an id and asks the API to create it, and the param lands in the URL once a write
 * succeeds. Edits fired before it settles share the same pending id so they land in one draft.
 */

// Whether each block procedure is a content write that starts a draft. Every procedure is
// listed, so a new one fails the type check until it's classified and can't be forgotten.
// `generateSummary` only fills a generated value (ADR 0012), so it doesn't start one.
const STARTS_DRAFT: Record<keyof Router["blocks"], boolean> = {
  get: false,
  getPageMarkdown: false,
  getLayoutMarkdown: false,
  getUsageCounts: false,
  getPagesUsing: false,
  getSyncedContent: false,
  create: true,
  updateContent: true,
  updateSettings: true,
  updatePosition: true,
  delete: true,
  deleteMany: true,
  generateSummary: false,
  duplicate: true,
};

let currentDraftId: string | null = null;
/** The id the first block writes on Live share, and how many of them are still in flight. */
let pending: { id: string; inFlight: number } | null = null;
const listeners = new Set<(draftId: string) => void>();

export function readDraftFromUrl() {
  pending = null;
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
  if (path.length !== 2 || path[0] !== "blocks") return false;
  return STARTS_DRAFT[path[1] as keyof Router["blocks"]] === true;
}

/** Headers for an API call at `path`, and a callback to report whether the call succeeded. */
export function getDraftRequestHeaders(path: readonly string[]): {
  headers: Record<string, string>;
  settle: (ok: boolean) => void;
} {
  const noop = () => {};
  if (currentDraftId) return { headers: { [DRAFT_HEADER]: currentDraftId }, settle: noop };
  if (!isBlockWrite(path)) return { headers: {}, settle: noop };

  pending ??= { id: generateUuidv7(), inFlight: 0 };
  const started = pending;
  started.inFlight += 1;
  return {
    headers: { [DRAFT_HEADER]: started.id, [DRAFT_CREATE_HEADER]: "1" },
    settle: (ok) => {
      if (pending !== started) return;
      started.inFlight -= 1;
      // Any write that succeeds created the draft; drop the id only once none can.
      if (ok) return enterDraft(started.id);
      if (started.inFlight === 0) pending = null;
    },
  };
}

/**
 * Switches the studio to Live once its draft was published or discarded. The draft is gone, so
 * the URL entry naming it is replaced rather than kept for Back.
 */
export function switchToLive() {
  pending = null;
  currentDraftId = null;
  const url = new URL(window.location.href);
  url.searchParams.delete(DRAFT_SEARCH_PARAM);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new window.CustomEvent("camox:navigation"));
}

function enterDraft(draftId: string) {
  pending = null;
  currentDraftId = draftId;
  const url = new URL(window.location.href);
  url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new window.CustomEvent("camox:navigation"));
  for (const listener of listeners) listener(draftId);
}
