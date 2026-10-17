import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  DRAFT_SEARCH_PARAM,
  type EndedDraft,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { LIVE_KEY_SCOPE, scopeOfKey } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { DraftNotice, DraftRead } from "../features/routes/pageRuntime";
import { getApiClient } from "./api-client";

/**
 * Which draft the studio is viewing (ADR 0011): a draft's id, or Live. There is one per server
 * request and one per browser window, provided through `DraftScopeContext` and handed to the API
 * client and the studio's reads (`studio-reads.ts`), so a server render reads the keys its
 * request seeded without any shared state.
 *
 * The URL's `camox-draft` param names the draft. Content writes start one: the first on Live
 * mints an id and asks the API to create it, and the param lands in the URL once a write
 * succeeds. Edits fired before it settles share the pending id, so they land in one draft.
 *
 * Dev mode works only in the caller's development draft and ignores the URL (ADR 0006): every
 * request and key names `development`, and no draft is ever started.
 */
export interface DraftScope {
  /** The draft viewed: a draft's id, `development` in dev mode, or null for Live. */
  current: () => string | null;
  /** Whether this is dev mode, which works only in the development draft (ADR 0006). */
  readonly developmentMode: boolean;
  /** Calls `listener` after every move to another scope, or after leaving one. */
  subscribe: (listener: (change: DraftScopeChange) => void) => () => void;

  /**
   * Headers for an API request, and a callback to report whether it succeeded. A content write
   * on Live starts a draft, which the scope enters once one of its writes succeeds.
   */
  requestHeaders: (contentWrite: boolean) => DraftRequestHeaders;
  /**
   * Where a link or navigation to `to` goes, naming the draft the way the URL does. A target on
   * this site keeps the viewed draft unless it names one itself, or `draft` switches to another
   * (`null` for Live). Other sites' URLs, and every URL in dev mode, are left alone. The result
   * keeps the target's form: a path stays a path. `from` resolves relative targets.
   */
  hrefFor: (to: string, options?: { from?: string; draft?: string | null }) => string;

  /**
   * Follows a render: the page now shown read `rendered`. Where it couldn't read the draft its
   * URL named, the param leaves the browser's URL in place and a member gets a notice. Queries
   * cached the last time an entered scope was shown are marked outdated.
   */
  adopt: (rendered: DraftRead) => void;
  /**
   * Switches to Live once the viewed draft was published or discarded, here or by someone else,
   * replacing its URL entry. A development draft never ends: it is emptied and dev mode stays in
   * it. With `notice`, a member is told who ended the draft. Returns whether it switched to Live.
   */
  leave: (ended: EndedDraft | null, options?: { notice?: boolean }) => boolean;
  /** Tells `listener` why the page shows Live; notices raised before any listener wait for one. */
  onNotice: (listener: (notice: DraftNotice) => void) => () => void;
  /**
   * The scope of the queries a realtime invalidation from `draftId` reaches. Dev mode keys its
   * queries `development`, so it resolves its development draft's id the first time it's asked.
   */
  keyScopeOfDraft: (draftId: string, projectId: number) => Promise<string>;
}

export type DraftScopeChange = {
  draftId: string | null;
  /** `started`: the first content write created a draft. `left`: the draft ended. */
  move: "adopted" | "started" | "left";
};

export type DraftRequestHeaders = {
  headers: Record<string, string>;
  settle: (ok: boolean) => void;
};

/** The parts of a browser window the scope reads and writes the URL through. */
export type DraftScopeBrowser = {
  location: { href: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string): void };
};

export interface DraftScopeOptions {
  queryClient: QueryClient;
  /** The window whose URL names the draft. Absent on the server. */
  browser?: DraftScopeBrowser;
  /** Defaults to whether the build is dev mode's. */
  developmentMode?: boolean;
  /** Reads the caller's development draft's id in a project, for realtime. */
  loadDevelopmentDraftId?: (projectId: number) => Promise<string | undefined>;
}

/** The draft a URL names, if any. */
export function draftNamedBy(href: string): string | null {
  return new URL(href, "http://camox.local").searchParams.get(DRAFT_SEARCH_PARAM) || null;
}

/** The URL without the draft param. */
export function withoutDraft(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(DRAFT_SEARCH_PARAM);
  return url.href;
}

function buildIsDevelopmentMode(): boolean {
  return typeof __CAMOX_DEVELOPMENT_DRAFT__ !== "undefined" && __CAMOX_DEVELOPMENT_DRAFT__;
}

export function createDraftScope({
  queryClient,
  browser,
  developmentMode = buildIsDevelopmentMode(),
  loadDevelopmentDraftId = async (projectId) =>
    (await getApiClient().drafts.get({ projectId }))?.id,
}: DraftScopeOptions): DraftScope {
  let current: string | null = developmentMode ? DEVELOPMENT_DRAFT : null;
  /** The id the first content writes on Live share, and how many of them are still in flight. */
  let pending: { id: string; inFlight: number } | null = null;
  let developmentDraftId: Promise<string | undefined> | undefined;
  /** Whether a render was adopted yet: the first shows what its own request read. */
  let adoptedRender = false;
  const listeners = new Set<(change: DraftScopeChange) => void>();
  const noticeListeners = new Set<(notice: DraftNotice) => void>();
  const pendingNotices: DraftNotice[] = [];

  /** The draft a render read. Dev mode follows it too: its development draft, or Live. */
  const draftOfRender = (rendered: DraftRead): string | null => {
    if (!developmentMode) return rendered.draftId ?? null;
    return rendered.refusedDraft ? null : DEVELOPMENT_DRAFT;
  };
  const notify = (move: DraftScopeChange["move"]) => {
    for (const listener of listeners) listener({ draftId: current, move });
  };
  const report = (notice: DraftNotice) => {
    if (noticeListeners.size === 0) return void pendingNotices.push(notice);
    for (const listener of noticeListeners) listener(notice);
  };
  /** Rewrites the browser's URL entry in place, naming `draftId` or no draft. */
  const replaceUrl = (draftId: string | null) => {
    if (!browser) return;
    const url = new URL(browser.location.href);
    if (draftId === url.searchParams.get(DRAFT_SEARCH_PARAM)) return;
    if (draftId) url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
    else url.searchParams.delete(DRAFT_SEARCH_PARAM);
    browser.history.replaceState(browser.history.state, "", url.pathname + url.search + url.hash);
  };

  /**
   * Enters the draft the first content write created. The draft is Live plus that write, so its
   * keys start from what Live showed, and nothing flashes empty while they refetch.
   */
  const enterStartedDraft = (draftId: string) => {
    pending = null;
    current = draftId;
    replaceUrl(draftId);
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["camox"] })) {
      if (scopeOfKey(query.queryKey) !== LIVE_KEY_SCOPE || query.state.data === undefined) continue;
      queryClient.setQueryData([...query.queryKey.slice(0, -1), draftId], query.state.data);
    }
    void queryClient.invalidateQueries({
      queryKey: ["camox"],
      predicate: (query) => scopeOfKey(query.queryKey) !== LIVE_KEY_SCOPE,
    });
    notify("started");
  };

  const headersFor = (contentWrite: boolean): DraftRequestHeaders => {
    const noop = () => {};
    if (current) return { headers: { [DRAFT_HEADER]: current }, settle: noop };
    // Dev mode never starts a draft: without the development draft, it can't write.
    if (!contentWrite || developmentMode) return { headers: {}, settle: noop };

    pending ??= { id: generateUuidv7(), inFlight: 0 };
    const started = pending;
    started.inFlight += 1;
    return {
      headers: { [DRAFT_HEADER]: started.id, [DRAFT_CREATE_HEADER]: "1" },
      settle: (ok) => {
        if (pending !== started) return;
        started.inFlight -= 1;
        // Any write that succeeds created the draft; drop the id only once none can.
        if (ok) return enterStartedDraft(started.id);
        if (started.inFlight === 0) pending = null;
      },
    };
  };

  return {
    current: () => current,
    developmentMode,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    requestHeaders: headersFor,
    hrefFor(to, { from, draft } = {}) {
      if (developmentMode) return to;
      const base = new URL(from ?? browser?.location.href ?? "http://camox.local");
      const target = new URL(to, base);
      if (target.origin !== base.origin) return to;
      if (draft === undefined && target.searchParams.has(DRAFT_SEARCH_PARAM)) return to;

      const next = draft === undefined ? current : draft;
      if (next) target.searchParams.set(DRAFT_SEARCH_PARAM, next);
      else target.searchParams.delete(DRAFT_SEARCH_PARAM);
      if (target.href === new URL(to, base).href) return to;
      return /^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//")
        ? target.href
        : `${target.pathname}${target.search}${target.hash}`;
    },

    adopt(rendered) {
      if (rendered.refusedDraft) {
        replaceUrl(null);
        if (rendered.refusedDraft.notice) report(rendered.refusedDraft.notice);
      }
      const next = draftOfRender(rendered);
      // A first write still in flight on Live started a draft only if the studio stays on Live.
      if (next !== null) pending = null;
      const firstRender = !adoptedRender;
      adoptedRender = true;
      if (next === current) return;
      current = next;
      // Queries cached the last time this scope was shown may be outdated by now. The first
      // render shows what its own request just read.
      if (!firstRender) {
        const entered = next ?? LIVE_KEY_SCOPE;
        void queryClient.invalidateQueries({
          queryKey: ["camox"],
          predicate: (query) => scopeOfKey(query.queryKey) === entered,
          refetchType: "none",
        });
      }
      notify("adopted");
    },
    leave(ended, { notice = false } = {}) {
      void queryClient.invalidateQueries({ queryKey: ["camox"] });
      if (developmentMode) return false;
      pending = null;
      current = null;
      replaceUrl(null);
      if (notice && ended) report({ reason: "ended", ...ended });
      notify("left");
      return true;
    },
    onNotice(listener) {
      noticeListeners.add(listener);
      for (const notice of pendingNotices.splice(0)) listener(notice);
      return () => noticeListeners.delete(listener);
    },
    async keyScopeOfDraft(draftId, projectId) {
      if (current !== DEVELOPMENT_DRAFT) return draftId;
      developmentDraftId ??= loadDevelopmentDraftId(projectId).catch(() => {
        developmentDraftId = undefined;
        return undefined;
      });
      return draftId === (await developmentDraftId) ? DEVELOPMENT_DRAFT : draftId;
    },
  };
}

export const DraftScopeContext = React.createContext<DraftScope | null>(null);

/**
 * The draft scope the studio is in, for handlers and effects. Render code reads the draft it
 * views from `useCurrentDraftId`: the scope object never changes, so a memoized render reading
 * `current()` from it would keep showing the draft of its first render.
 */
export function useDraftScope(): DraftScope {
  const scope = React.useContext(DraftScopeContext);
  if (!scope) throw new Error("useDraftScope must be used inside a DraftScopeContext provider");
  return scope;
}

const noScope = () => null;
const noSubscription = () => () => {};

/** The draft the studio is in, or null for Live. The caller re-renders after every move. */
export function useCurrentDraftId(): string | null {
  const scope = useDraftScope();
  return React.useSyncExternalStore(scope.subscribe, scope.current, scope.current);
}

/** The draft scope and the draft it views, outside the studio too, where there is none. */
export function useOptionalDraftScope(): { scope: DraftScope | null; draftId: string | null } {
  const scope = React.useContext(DraftScopeContext);
  const current = scope?.current ?? noScope;
  const draftId = React.useSyncExternalStore(scope?.subscribe ?? noSubscription, current, current);
  return { scope, draftId };
}

/**
 * Follows the draft a browser URL names, for a studio mounted in a host application, whose
 * navigation renders nothing the scope could adopt.
 */
export function followUrl(scope: DraftScope, href: string) {
  scope.adopt({ draftId: draftNamedBy(href) ?? undefined });
}
