import type { RevisionAnnouncement } from "@camox/api-contract/query-keys";
import * as React from "react";

/**
 * The new revisions the project room announces, for whatever shows a draft's code to follow:
 * the Website Section's renderer frame loads each new revision of the draft it shows, and the
 * social previews fetch the page image its layout's code renders again.
 */
export interface Revisions {
  /** Tells every listener about a draft's new revision. */
  announce(revision: RevisionAnnouncement): void;
  /** Calls `listener` with each revision announced. Returns a function that stops calling it. */
  subscribe: (listener: (revision: RevisionAnnouncement) => void) => () => void;
  /** The last revision announced for `draftId` since the studio opened, if any. */
  latest: (draftId: string) => string | null;
}

export function createRevisions(): Revisions {
  const listeners = new Set<(revision: RevisionAnnouncement) => void>();
  const latest = new Map<string, string>();
  return {
    announce(revision) {
      latest.set(revision.draftId, revision.revisionId);
      for (const listener of listeners) listener(revision);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    latest: (draftId) => latest.get(draftId) ?? null,
  };
}

/** The studio's announced revisions. The signed-in studio provides it. */
export const RevisionsContext = React.createContext<Revisions | null>(null);

const noSubscription = () => () => {};

/**
 * The last revision announced for `draftId` since the studio opened, or null, following each new
 * one: what a URL rendered by the draft's code names, so it is fetched again once a new one built.
 */
export function useLatestRevision(draftId: string | null): string | null {
  const revisions = React.use(RevisionsContext);
  const latest = () => (revisions && draftId ? revisions.latest(draftId) : null);
  return React.useSyncExternalStore(revisions?.subscribe ?? noSubscription, latest, latest);
}
