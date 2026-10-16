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
import { useSelector } from "@xstate/store-react";
import { ChevronDownIcon, Eye, Trash2 } from "lucide-react";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";
import { AuthContext } from "@/lib/auth";
import { draftQueries, projectQueries, type DraftList, type DraftSummary } from "@/lib/queries";
import { isDevelopmentMode, onDraftStarted } from "@/lib/studio-draft";

import { type Action, actionsStore } from "../../provider/actionsStore";
import { draftLabel, plural, timeAgo } from "../draftLabel";
import { studioStore } from "../studioStore";
import {
  DiscardDraftDialog,
  ReviewDraftDialog,
  useCurrentDraftId,
  useLeaveDraft,
} from "./ReviewDraftDialog";

const LIVE = "live";
const SWITCH_TO_DRAFT_ID = "switch-to-draft";

// Green while viewing Live, blue in a draft: the tints of the former site status indicator.
const liveClassName =
  "border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/10 hover:text-green-700 dark:border-green-400/30 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/20 dark:hover:text-green-400";
const draftClassName =
  "border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/20 dark:hover:text-blue-400";

/**
 * The studio's one drafts control (#203): what the studio is viewing, Live or a draft, the
 * draft's actions, and the drafts to switch to. Live is read-only; the first edit starts a draft.
 * The localhost studio works only in the development draft, so it shows that draft alone, with
 * nothing to switch to (ADR 0006). The command palette offers the same actions (#288).
 */
export function DraftsControl() {
  const draftId = useCurrentDraftId();
  const authCtx = React.useContext(AuthContext);
  const navigate = useNavigate();
  const leaveDraft = useLeaveDraft();
  const review = useSelector(studioStore, (state) => state.context.reviewDraftDialog);
  const discarding = useSelector(studioStore, (state) => state.context.isDiscardDraftDialogOpen);
  const developmentMode = isDevelopmentMode();

  React.useEffect(() => onDraftStarted(() => void toast.success("Started a new draft")), []);
  // The dialogs belong to the draft they were opened in.
  React.useEffect(
    () => () => {
      studioStore.send({ type: "closeReviewDraftDialog" });
      studioStore.send({ type: "closeDiscardDraftDialog" });
    },
    [draftId],
  );

  const project = useQuery({
    ...projectQueries.getBySlug(authCtx?.projectSlug ?? ""),
    enabled: !!authCtx?.projectSlug,
  });
  const projectId = project.data?.id;
  const list = useQuery({
    ...draftQueries.list(projectId ?? 0),
    enabled: !!projectId && !developmentMode,
  });
  const draft = useQuery({
    ...draftQueries.get(projectId ?? 0, draftId ?? ""),
    enabled: !!projectId && !!draftId,
  });

  // The hosted studio never lists development drafts (ADR 0011).
  const regular = (list.data?.drafts ?? []).filter((listed) => listed.kind === "regular");
  const live = list.data?.live;

  const switchTo = (value: unknown) => {
    const next = value === LIVE ? null : String(value);
    if (next === draftId) return;
    void navigate({ to: window.location.href, draft: next });
  };

  useDraftsActions({ enabled: !!projectId, draftId, drafts: list.data?.drafts });

  if (!projectId) return null;
  // Without its development draft, the localhost studio has nothing to show or switch to.
  if (developmentMode && !draftId) return null;
  const current = draftId ? draft.data : undefined;

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
              <DropdownMenuItem onClick={() => studioStore.send({ type: "openReviewDraftDialog" })}>
                <Eye />
                Review and publish
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => studioStore.send({ type: "openDiscardDraftDialog" })}
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
          {!developmentMode && (
            <>
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
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {draftId && (
        <>
          <ReviewDraftDialog
            projectId={projectId}
            draftId={draftId}
            open={review.open}
            startRenaming={review.startRenaming}
            onOpenChange={(open) => {
              if (!open) studioStore.send({ type: "closeReviewDraftDialog" });
            }}
          />
          <DiscardDraftDialog
            projectId={projectId}
            open={discarding}
            onOpenChange={(open) => {
              if (!open) studioStore.send({ type: "closeDiscardDraftDialog" });
            }}
            onDiscarded={leaveDraft}
          />
        </>
      )}
    </>
  );
}

/**
 * The drafts control's actions in the command palette, offered where the control's menu offers
 * them. The palette only opens the review and the discard confirmation; it never publishes or
 * discards by itself.
 */
function useDraftsActions({
  enabled,
  draftId,
  drafts,
}: {
  enabled: boolean;
  draftId: string | null;
  drafts: DraftSummary[] | undefined;
}) {
  const developmentMode = isDevelopmentMode();
  const navigate = useNavigate();
  React.useEffect(() => {
    const inDraft = enabled && !!draftId;
    const switchTo = (next: string | null) =>
      void navigate({ to: window.location.href, draft: next });
    // Like the control's menu, the hosted studio never lists development drafts (ADR 0011), and
    // the localhost studio lists none.
    const others = (drafts ?? []).filter(
      (listed) => listed.kind === "regular" && listed.id !== draftId,
    );
    const actions: Action[] = [
      {
        id: "review-draft",
        label: "Review and publish",
        aliases: ["Publish", "Deploy", "Go live", "Push to production", "Ship"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openReviewDraftDialog" }),
      },
      {
        id: "discard-draft",
        label: "Discard draft…",
        aliases: ["Delete draft", "Throw away changes", "Revert changes"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openDiscardDraftDialog" }),
      },
      {
        id: "rename-draft",
        label: "Rename draft…",
        aliases: ["Name draft"],
        groupLabel: "Drafts",
        // Only a regular draft has a name.
        checkIfAvailable: () => inDraft && !developmentMode,
        execute: () => studioStore.send({ type: "openReviewDraftDialog", startRenaming: true }),
      },
      {
        id: "switch-to-live",
        label: "Switch to Live",
        aliases: ["Leave draft", "Exit draft", "Production", "Public website"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft && !developmentMode,
        execute: () => switchTo(null),
      },
      {
        id: SWITCH_TO_DRAFT_ID,
        label: "Switch to draft…",
        aliases: ["Open draft", "Change draft", "Drafts"],
        groupLabel: "Drafts",
        checkIfAvailable: () => others.length > 0,
        hasChildren: true,
        execute: () => {},
      },
      ...others.map(
        (other): Action => ({
          id: `${SWITCH_TO_DRAFT_ID}-${other.id}`,
          parentActionId: SWITCH_TO_DRAFT_ID,
          label: `Switch to "${draftLabel(other)}"`,
          aliases: [other.createdBy.name],
          groupLabel: "Drafts",
          checkIfAvailable: () => true,
          execute: () => switchTo(other.id),
        }),
      ),
    ];

    actionsStore.send({ type: "registerManyActions", actions });
    return () => {
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((a) => a.id) });
    };
  }, [enabled, draftId, drafts, developmentMode, navigate]);
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
