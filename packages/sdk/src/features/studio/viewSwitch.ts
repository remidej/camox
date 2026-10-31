import type { EndedDraft } from "@camox/api-contract/drafts";
import { toast } from "@camox/ui/toaster";
import * as React from "react";

import { useDraftScope } from "@/lib/draft-scope";
import { useViewShown } from "@/lib/view-switch";

/** What the toast of a switch to another view says, while it loads and once it shows. */
export type SwitchMessages = { loading: string; success: string };

/**
 * Tells the editor the studio heard them while it switches to another draft or locale: the
 * studio keeps showing what it showed until the next view is ready, then shows it at once.
 * `switching` settles once it shows.
 */
function toastSwitch(switching: Promise<unknown>, messages: SwitchMessages) {
  toast.promise(switching, {
    ...messages,
    error: "Something went wrong while switching. Reload the page to try again.",
  });
}

/**
 * Switches to another draft or locale with `navigate`, which starts the navigation that does,
 * saying so in a toast until the next view shows.
 */
export function useSwitchView() {
  const shown = useViewShown();
  return React.useCallback(
    (navigate: () => unknown, messages: SwitchMessages) =>
      toastSwitch(
        Promise.resolve(navigate()).then(() => shown()),
        messages,
      ),
    [shown],
  );
}

/**
 * Switches the studio to Live once the draft it views ended, by this member, here or in another
 * tab, replacing the draft's URL entry. Called once the studio already left the draft, it does
 * nothing.
 */
export function useLeaveDraft() {
  const draftScope = useDraftScope();
  const shown = useViewShown();
  return React.useCallback(
    (ended: EndedDraft | null, { discarded = false }: { discarded?: boolean } = {}) => {
      if (ended && draftScope.current() !== ended.draftId) return;
      draftScope.leave(ended);
      if (!ended) return;
      const what = discarded ? "Changes discarded" : `Draft ${ended.outcome}`;
      toastSwitch(shown(), {
        loading: `${what}. Switching to Live…`,
        success: `${what}. You're now viewing Live.`,
      });
    },
    [draftScope, shown],
  );
}
