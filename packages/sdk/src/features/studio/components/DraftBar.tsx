import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import * as React from "react";

import { cn } from "@/lib/utils";

import { plural } from "../draftLabel";
import { studioStore } from "../studioStore";
import { useDrafts } from "./DraftsControl";

/**
 * How long a draft goes without a change before its bar shows, so it doesn't pop up mid-edit.
 */
export const SETTLE_MS = 1500;

/**
 * Asks what to do with the draft being viewed, once its edits settle: delete it or publish it. `stacked` places it in the Preview toolbar's column, just above the toolbar;
 * otherwise it floats at the bottom of the screen on its own.
 */
export function DraftBar({ stacked = false }: { stacked?: boolean }) {
  const { projectId, current } = useDrafts();
  const settled = useSettled(current?.id ?? null, current?.lastChangedAt ?? null);
  if (!projectId || !current || !settled) return null;
  const empty = current.changeCount === 0;

  return (
    <FloatingToolbar
      aria-label="Draft"
      className={cn(
        "w-max gap-4",
        // Fixed when alone, so it centers on the viewport like the Preview toolbar would.
        stacked ? "pointer-events-auto relative left-auto translate-x-0" : "fixed bottom-2",
      )}
    >
      <span className="flex items-center gap-2 px-2 text-sm">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-blue-500" />
        {empty ? "No changes yet" : plural(current.changeCount, "pending change")}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => studioStore.send({ type: "openDeleteDraftDialog" })}
        >
          Delete
        </Button>
        <Button
          type="button"
          disabled={empty}
          onClick={() => studioStore.send({ type: "openReviewDraftSheet" })}
        >
          Publish…
        </Button>
      </div>
    </FloatingToolbar>
  );
}

/**
 * Whether the draft went without a change for `SETTLE_MS`. Once settled it stays so for that
 * draft, so the bar doesn't hide again on the next edit.
 */
function useSettled(draftId: string | null, lastChangedAt: number | null) {
  const [settledDraft, setSettledDraft] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!draftId || settledDraft === draftId) return;
    const wait = Math.max(0, (lastChangedAt ?? 0) + SETTLE_MS - Date.now());
    const timer = setTimeout(() => setSettledDraft(draftId), wait);
    return () => clearTimeout(timer);
  }, [draftId, lastChangedAt, settledDraft]);
  return !!draftId && settledDraft === draftId;
}
