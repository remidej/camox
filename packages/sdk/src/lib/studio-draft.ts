import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  DRAFT_SEARCH_PARAM,
  isContentWrite,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { inScope, LIVE_KEY_SCOPE, scopeOfKey, type QueryKey } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";

import type { DraftNotice, DraftRead } from "../features/routes/pageRuntime";

/**
 * The draft the studio reads and writes (ADR 0011). The URL's `camox-draft` param names it;
 * without one the studio is on Live. Content writes start a draft: the first one on Live mints
 * an id and asks the API to create it, and the param lands in the URL once a write succeeds.
 * Edits fired before it settles share the same pending id so they land in one draft. The API
 * rejects content writes naming no draft, so this is the only path from an edit to the API.
 *
 * Dev mode works only in the caller's development draft and ignores the URL (ADR 0006): every
 * request names `development`, and no draft is ever started.
 */

let currentDraftId: string | null = null;
/**
 * Dev mode: whether the last render could read the development draft. Without its owner's
 * session it read Live, and the page keeps showing Live.
 */
let developmentDraftRead = true;
/** The id the first content writes on Live share, and how many of them are still in flight. */
let pending: { id: string; inFlight: number } | null = null;
const listeners = new Set<(draftId: string) => void>();

/** Whether this is dev mode, which works only in the development draft (ADR 0006). */
export function isDevelopmentMode(): boolean {
  return typeof __CAMOX_DEVELOPMENT_DRAFT__ !== "undefined" && __CAMOX_DEVELOPMENT_DRAFT__;
}

/**
 * Follows the URL: the draft its param names, or Live. Navigations call it once they commit,
 * with what the page they show read. Dev mode follows that render instead of the URL: the
 * development draft, or Live when the render couldn't read it.
 */
export function readDraftFromUrl(rendered?: DraftRead) {
  pending = null;
  if (isDevelopmentMode()) {
    if (rendered) developmentDraftRead = !rendered.refusedDraft;
    currentDraftId = developmentDraftRead ? DEVELOPMENT_DRAFT : null;
    return;
  }
  // A server render has no URL to follow: it keeps the draft `renderInDraft` gave it.
  if (typeof window === "undefined") return;
  currentDraftId = new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM) || null;
}

/**
 * Runs a synchronous server render in the draft its request read, so its queries read the
 * keys the server seeded. The render can't interleave with another request's, since nothing
 * awaits until it returns.
 */
export function renderInDraft<T>(draftId: string | undefined, render: () => T): T {
  const previous = currentDraftId;
  currentDraftId = draftId ?? null;
  try {
    return render();
  } finally {
    currentDraftId = previous;
  }
}

export function getCurrentDraftId(): string | null {
  return currentDraftId;
}

/**
 * A query key as the studio caches it: ending in the draft it reads, or `live` (ADR 0011). Each
 * draft's queries are cached apart, so a draft's realtime invalidations refetch only its own.
 */
export function scopedKey(key: QueryKey): QueryKey {
  return inScope(key, currentDraftId);
}

/**
 * Seeds a draft the studio just started with what it showed on Live: the draft is Live plus the
 * first edit, so the studio keeps showing it while its queries refetch from the draft.
 */
export function seedStartedDraft(queryClient: QueryClient, draftId: string) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["camox"] })) {
    if (scopeOfKey(query.queryKey) !== LIVE_KEY_SCOPE || query.state.data === undefined) continue;
    queryClient.setQueryData([...query.queryKey.slice(0, -1), draftId], query.state.data);
  }
}

const noticeListeners = new Set<(notice: DraftNotice) => void>();
const pendingNotices: DraftNotice[] = [];

/**
 * Tells a member why the page shows Live instead of the draft its URL named. Notices reported
 * before anyone listens wait for the first listener, which mounts with the studio's toaster.
 */
export function reportDraftNotice(notice: DraftNotice) {
  if (noticeListeners.size === 0) return void pendingNotices.push(notice);
  for (const listener of noticeListeners) listener(notice);
}

export function onDraftNotice(listener: (notice: DraftNotice) => void): () => void {
  noticeListeners.add(listener);
  for (const notice of pendingNotices.splice(0)) listener(notice);
  return () => noticeListeners.delete(listener);
}

/** Called once the first content write has created a draft and the studio switched into it. */
export function onDraftStarted(listener: (draftId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type DraftRequestHeaders = {
  headers: Record<string, string>;
  settle: (ok: boolean) => void;
};

/** Headers for an API call at `path`, and a callback to report whether the call succeeded. */
export function getDraftRequestHeaders(path: readonly string[]): DraftRequestHeaders {
  return headersFor(isContentWrite(path));
}

/**
 * Headers for a file upload or replacement, which writes content outside oRPC: on Live it
 * starts a draft like any other content write.
 */
export function getUploadDraftHeaders(): DraftRequestHeaders {
  return headersFor(true);
}

function headersFor(write: boolean): DraftRequestHeaders {
  const noop = () => {};
  if (currentDraftId) return { headers: { [DRAFT_HEADER]: currentDraftId }, settle: noop };
  // Dev mode never starts a draft: without the development draft, it can't write.
  if (!write || isDevelopmentMode()) return { headers: {}, settle: noop };

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
