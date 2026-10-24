import type { RevisionAnnouncement } from "@camox/api-contract/query-keys";
import * as React from "react";

/**
 * The new revisions the project room announces, for whatever shows a draft's code to follow:
 * the Website Section's renderer frame loads each new revision of the draft it shows.
 */
export interface Revisions {
  /** Tells every listener about a draft's new revision. */
  announce(revision: RevisionAnnouncement): void;
  /** Calls `listener` with each revision announced. Returns a function that stops calling it. */
  subscribe(listener: (revision: RevisionAnnouncement) => void): () => void;
}

export function createRevisions(): Revisions {
  const listeners = new Set<(revision: RevisionAnnouncement) => void>();
  return {
    announce(revision) {
      for (const listener of listeners) listener(revision);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The studio's announced revisions. The signed-in studio provides it. */
export const RevisionsContext = React.createContext<Revisions | null>(null);
