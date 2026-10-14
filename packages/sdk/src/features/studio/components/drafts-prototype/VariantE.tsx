/**
 * PROTOTYPE (#203), throwaway. Variant E, "Status dropdown": today's
 * SiteStatusIndicator ("Everything live" / "Pending changes") becomes the whole
 * drafts control. Its tinted trigger says what you're viewing, and its menu
 * holds the draft's actions above the list of drafts to switch to. Reviewing
 * opens D's two-column modal.
 */
import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { toast } from "@camox/ui/toaster";
import { ChevronDownIcon, Eye, Trash2 } from "lucide-react";
import * as React from "react";

import { CreatorLine, TOASTER_ID, useDrafts, usePublish } from "./shared";
import { type Draft, draftLabel, draftsStore, timeAgo } from "./store";
import { ReviewDialogs } from "./VariantD";

export const name = "Status dropdown";

// The tints SiteStatusIndicator uses for "Everything live" and "Pending changes".
const liveClassName =
  "border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/10 hover:text-green-700 dark:border-green-400/30 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/20 dark:hover:text-green-400";
const draftClassName =
  "border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/20 dark:hover:text-blue-400";

/** Nothing next to the project menu, as today. */
export function Left() {
  return null;
}

export function Right() {
  const { drafts, current, draft, live, startedDraftId } = useDrafts();
  const publish = usePublish(draft);
  const [discarding, setDiscarding] = React.useState(false);

  React.useEffect(() => {
    if (!startedDraftId) return;
    const started = draftsStore.getSnapshot().context.drafts.find((d) => d.id === startedDraftId);
    draftsStore.send({ type: "acknowledgeStarted" });
    if (!started) return;
    toast.success("Started a new draft", {
      toasterId: TOASTER_ID,
      description: `Your change is saved in “${draftLabel(started)}”, not on Live.`,
    });
  }, [startedDraftId]);

  const development = drafts.filter((d) => d.development);
  const regular = drafts.filter((d) => !d.development);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={draft ? draftClassName : liveClassName}
            />
          }
        >
          {draft ? (
            <>
              <span className="max-w-48 truncate">{draftLabel(draft)}</span>
              <span className="opacity-70">
                · {draft.changes.length} change{draft.changes.length === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            "Viewing Live"
          )}
          <ChevronDownIcon aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="end">
          {draft ? (
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={draft.changes.length === 0} onClick={publish.openReview}>
                <Eye />
                Review and publish
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={draft.changes.length === 0}
                onClick={() => setDiscarding(true)}
              >
                <Trash2 />
                Discard draft…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                Live is read-only. Your first edit starts a new draft.
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(id) => draftsStore.send({ type: "select", id: id as string })}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch to</DropdownMenuLabel>
              <DropdownMenuRadioItem value="live">
                <div className="flex flex-col">
                  <span>Live</span>
                  <span className="text-muted-foreground text-xs">
                    Published {timeAgo(live.publishedAt)} by {live.publishedBy}
                  </span>
                </div>
              </DropdownMenuRadioItem>
              {development.map((d) => (
                <DraftItem key={d.id} draft={d} />
              ))}
              {regular.map((d) => (
                <DraftItem key={d.id} draft={d} />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {draft && (
        <ReviewDialogs
          draft={draft}
          publish={publish}
          discarding={discarding}
          setDiscarding={setDiscarding}
        />
      )}
    </>
  );
}

function DraftItem({ draft }: { draft: Draft }) {
  return (
    <DropdownMenuRadioItem value={draft.id}>
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{draftLabel(draft)}</span>
        <CreatorLine draft={draft} />
      </div>
    </DropdownMenuRadioItem>
  );
}
