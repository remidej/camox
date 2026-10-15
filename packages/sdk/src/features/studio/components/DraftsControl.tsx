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
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, Eye, Trash2 } from "lucide-react";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";
import { AuthContext } from "@/lib/auth";
import { draftQueries, projectQueries, type DraftList, type DraftSummary } from "@/lib/queries";
import { onDraftStarted } from "@/lib/studio-draft";

import { draftLabel, plural, timeAgo } from "../draftLabel";
import {
  DiscardDraftDialog,
  ReviewDraftDialog,
  useCurrentDraftId,
  useLeaveDraft,
} from "./ReviewDraftDialog";

const LIVE = "live";

// Green while viewing Live, blue in a draft: the tints of the former site status indicator.
const liveClassName =
  "border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/10 hover:text-green-700 dark:border-green-400/30 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/20 dark:hover:text-green-400";
const draftClassName =
  "border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/20 dark:hover:text-blue-400";

/**
 * The studio's one drafts control (#203): what the studio is viewing, Live or a draft, the
 * draft's actions, and the drafts to switch to. Live is read-only; the first edit starts a draft.
 */
export function DraftsControl() {
  const draftId = useCurrentDraftId();
  const authCtx = React.useContext(AuthContext);
  const navigate = useNavigate();
  const leaveDraft = useLeaveDraft();
  const [reviewing, setReviewing] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);

  React.useEffect(() => onDraftStarted(() => void toast.success("Started a new draft")), []);

  const project = useQuery({
    ...projectQueries.getBySlug(authCtx?.projectSlug ?? ""),
    enabled: !!authCtx?.projectSlug,
  });
  const projectId = project.data?.id;
  const list = useQuery({ ...draftQueries.list(projectId ?? 0), enabled: !!projectId });
  const draft = useQuery({
    ...draftQueries.get(projectId ?? 0, draftId ?? ""),
    enabled: !!projectId && !!draftId,
  });

  if (!projectId) return null;
  const current = draftId ? draft.data : undefined;
  // The production studio never lists development drafts (ADR 0011).
  const regular = (list.data?.drafts ?? []).filter((listed) => listed.kind === "regular");
  const live = list.data?.live;

  const switchTo = (value: unknown) => {
    const next = value === LIVE ? null : String(value);
    if (next === draftId) return;
    void navigate({ to: window.location.href, draft: next });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={draftId ? draftClassName : liveClassName}
            />
          }
        >
          {draftId ? (
            <>
              <span className="max-w-48 truncate">{current ? draftLabel(current) : "Draft"}</span>
              {current && (
                <span className="opacity-70"> · {plural(current.changeCount, "change")}</span>
              )}
            </>
          ) : (
            "Viewing Live"
          )}
          <ChevronDownIcon aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="end">
          {draftId ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setReviewing(true)}>
                <Eye />
                Review and publish
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDiscarding(true)}>
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
          <DropdownMenuRadioGroup value={draftId ?? LIVE} onValueChange={switchTo}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch to</DropdownMenuLabel>
              <DropdownMenuRadioItem value={LIVE} closeOnClick>
                <div className="flex flex-col">
                  <span>Live</span>
                  <span className="text-muted-foreground text-xs">{liveLine(live)}</span>
                </div>
              </DropdownMenuRadioItem>
              {regular.map((listed) => (
                <DraftItem key={listed.id} draft={listed} />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {draftId && (
        <>
          <ReviewDraftDialog
            projectId={projectId}
            draftId={draftId}
            open={reviewing}
            onOpenChange={setReviewing}
          />
          <DiscardDraftDialog
            projectId={projectId}
            open={discarding}
            onOpenChange={setDiscarding}
            onDiscarded={leaveDraft}
          />
        </>
      )}
    </>
  );
}

/** Who published Live last and when: a member, a release, or nobody yet. */
function liveLine(live: DraftList["live"] | undefined): string {
  if (!live?.publishedAt) return "Never published";
  const by = live.publishedBy ? live.publishedBy.name : "a release";
  return `Published ${timeAgo(live.publishedAt)} by ${by}`;
}

function DraftItem({ draft }: { draft: DraftSummary }) {
  return (
    <DropdownMenuRadioItem value={draft.id} closeOnClick>
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{draftLabel(draft)}</span>
        <span className="text-muted-foreground text-xs">
          {draft.createdBy.name} · {timeAgo(draft.createdAt)} ·{" "}
          {plural(draft.changeCount, "change")}
        </span>
      </div>
    </DropdownMenuRadioItem>
  );
}
