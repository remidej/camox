import * as React from "react";

import type { LocaleView } from "./locale-path";

/**
 * A switch to another draft or locale keeps the studio showing what it showed until the next
 * view is ready, then shows it at once: the page runtime renders the next view in a transition,
 * which commits only once what it reads has loaded and every preparer is done.
 */

/** The view a switch goes to, as the runtime read it. */
export type NextView = {
  /** The page's path, as the runtime reads it at `/_camox/data`. */
  pathname: string;
  /** The derived layout whose page this is, if any. */
  derivedLayoutId?: string;
  /** The draft it shows, or null for Live. */
  draftId: string | null;
  locale: LocaleView;
};

/**
 * Gets what the studio shows, other than its own reads, ready for `next`. The switch commits once
 * it settles, or gives up waiting for it after {@link SWITCH_WAIT_MS}.
 */
export type ViewPreparer = (next: NextView) => Promise<unknown>;

/** What the page runtime lets the studio know of its switches. */
export type ViewSwitches = {
  /** Registers a preparer for every switch, until the returned function is called. */
  prepare: (preparer: ViewPreparer) => () => void;
  /**
   * Settles once the last navigation started shows, or another took over from it: right away
   * without one in progress.
   */
  shown: () => Promise<void>;
};

export const ViewSwitchesContext = React.createContext<ViewSwitches | null>(null);

/**
 * Set while a render switches to another view: the time after which it stops waiting for reads
 * and commits with what it has. Null otherwise.
 */
export const ViewSwitchDeadlineContext = React.createContext<number | null>(null);

/** How long a switch waits for the next view before showing it however far it got. */
export const SWITCH_WAIT_MS = 10_000;

/** Prepares the studio's part of every switch with `preparer`, while mounted. */
export function useViewPreparer(preparer: ViewPreparer) {
  const switches = React.use(ViewSwitchesContext);
  const prepare = React.useEffectEvent(preparer);
  React.useEffect(() => switches?.prepare((next) => prepare(next)), [switches]);
}

/**
 * The last navigation started, settling once it shows: for the studio to say a switch it started,
 * or one that followed what it did, is under way. Outside the page runtime, it settles at once.
 */
export function useViewShown(): () => Promise<void> {
  const switches = React.use(ViewSwitchesContext);
  return React.useCallback(() => switches?.shown() ?? Promise.resolve(), [switches]);
}

/**
 * While a render switches views, a read still loading holds the switch back rather than show
 * its loading state: the promise to suspend on until it loads or the switch stops waiting.
 * Undefined when the render should show the read as it is.
 */
export function useSwitchHold(
  loading: () => Promise<unknown> | null,
): Promise<unknown> | undefined {
  const deadline = React.use(ViewSwitchDeadlineContext);
  if (deadline === null) return undefined;
  const left = deadline - Date.now();
  if (left <= 0) return undefined;
  const pending = loading();
  if (!pending) return undefined;
  return Promise.race([
    pending.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, left)),
  ]);
}
