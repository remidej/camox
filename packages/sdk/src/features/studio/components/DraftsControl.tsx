import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { toast } from "@camox/ui/toaster";
import { useSelector } from "@xstate/store-react";
import { ChevronsUpDown } from "lucide-react";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";
import { AuthContext } from "@/lib/auth";
import { useCurrentDraftId, useDraftScope } from "@/lib/draft-scope";
import { type DraftList, type DraftSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { draftLabel, plural, timeAgo } from "../draftLabel";
import { studioStore } from "../studioStore";
import { useLeaveDraft, useSwitchView } from "../viewSwitch";
import { DeleteDraftDialog, ReviewDraftSheet } from "./ReviewDraftSheet";

const LIVE = "live";
const SWITCH_TO_DRAFT_ID = "switch-to-draft";

/** What the drafts controls read: the project, the current draft, and the drafts to switch to. */
export function useDrafts() {
  const draftScope = useDraftScope();
  const draftId = useCurrentDraftId();
  const authCtx = React.useContext(AuthContext);
  const project = useReadQuery(reads.project({ projectUuid: authCtx?.projectUuid ?? "" }), {
    enabled: !!authCtx?.projectUuid,
  });
  const projectId = project.data?.id;
  const list = useReadQuery(reads.draftList({ projectId: projectId ?? 0 }), {
    enabled: !!projectId,
  });
  const draft = useReadQuery(reads.draft({ projectId: projectId ?? 0, draftId: draftId ?? "" }), {
    enabled: !!projectId && !!draftId,
  });
  return {
    draftScope,
    draftId,
    projectId,
    list: list.data,
    current: draftId ? draft.data : undefined,
  };
}

/**
 * Picks what the studio is viewing, Live or a draft (#203). Live is read-only; the first edit
 * starts a draft. The command palette offers the same actions,
 * and the picker hosts the draft's review and delete confirmation they open. A `disabled` picker
 * still names what the studio is viewing.
 */
export function DraftPicker({ disabled = false }: { disabled?: boolean }) {
  const { draftScope, draftId, projectId, list, current } = useDrafts();
  const navigate = useNavigate();
  const leaveDraft = useLeaveDraft();
  const switchView = useSwitchView();
  const review = useSelector(studioStore, (state) => state.context.reviewDraftSheet);
  const deleting = useSelector(studioStore, (state) => state.context.isDeleteDraftDialogOpen);

  React.useEffect(
    () =>
      draftScope.subscribe(({ move }) => {
        if (move === "started") toast.success("Started a new draft");
      }),
    [draftScope],
  );
  // The dialogs belong to the draft they were opened in.
  React.useEffect(
    () => () => {
      studioStore.send({ type: "closeReviewDraftSheet" });
      studioStore.send({ type: "closeDeleteDraftDialog" });
    },
    [draftId],
  );

  const listed = list?.drafts;
  const drafts = React.useMemo(() => listed ?? [], [listed]);

  /** Views the same page in another draft, or in Live when `next` is null. */
  const switchTo = React.useCallback(
    (next: string | null) => {
      if (next === draftId) return;
      const target = next ? drafts.find((draft) => draft.id === next) : undefined;
      const label = next ? (target ? draftLabel(target) : "the draft") : "Live";
      switchView(() => navigate({ to: window.location.href, draft: next }), {
        loading: `Switching to ${label}…`,
        success: `You're now viewing ${label}.`,
      });
    },
    [draftId, drafts, navigate, switchView],
  );

  useDraftsActions({
    enabled: !!projectId,
    draftId,
    unnamed: current?.name === null,
    drafts,
    switchTo,
  });

  // Live shows at once. A draft's label needs its name, so it waits rather than flash a
  // placeholder.
  if (draftId && !current) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" />}>
          {/* Green on Live, blue in a draft. */}
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              draftId ? "bg-blue-500" : "bg-emerald-500",
            )}
          />
          <span className="max-w-48 truncate">{draftId ? draftLabel(current!) : "Live"}</span>
          <ChevronsUpDown aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start">
          <>
            {!draftId && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground font-normal">
                    Live is read-only. Your first edit starts a new draft.
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuRadioGroup
              value={draftId ?? LIVE}
              onValueChange={(value) => switchTo(value === LIVE ? null : String(value))}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Switch to</DropdownMenuLabel>
                <DropdownMenuRadioItem value={LIVE} closeOnClick>
                  <div className="flex flex-col">
                    <span>Live</span>
                    {list && (
                      <span className="text-muted-foreground text-xs">{liveLine(list.live)}</span>
                    )}
                  </div>
                </DropdownMenuRadioItem>
                {drafts.map((draft) => (
                  <DraftItem key={draft.id} draft={draft} />
                ))}
              </DropdownMenuGroup>
            </DropdownMenuRadioGroup>
          </>
        </DropdownMenuContent>
      </DropdownMenu>

      {draftId && projectId && (
        <>
          <ReviewDraftSheet
            projectId={projectId}
            draftId={draftId}
            open={review.open}
            startRenaming={review.startRenaming}
            onOpenChange={(open) => {
              if (!open) studioStore.send({ type: "closeReviewDraftSheet" });
            }}
          />
          <DeleteDraftDialog
            projectId={projectId}
            open={deleting}
            discard={current?.name === null}
            onOpenChange={(open) => {
              if (!open) studioStore.send({ type: "closeDeleteDraftDialog" });
            }}
            onDeleted={(ended) => leaveDraft(ended, { discarded: current?.name === null })}
          />
        </>
      )}
    </>
  );
}

/**
 * The drafts controls' actions in the command palette, offered where the controls offer them. The palette only opens the review and the delete confirmation; it never publishes or
 * deletes by itself.
 */
function useDraftsActions({
  enabled,
  draftId,
  unnamed,
  drafts,
  switchTo,
}: {
  enabled: boolean;
  draftId: string | null;
  /** Whether the current draft is unnamed, whose deletion discards its changes. */
  unnamed: boolean;
  drafts: DraftSummary[];
  switchTo: (next: string | null) => void;
}) {
  React.useEffect(() => {
    const inDraft = enabled && !!draftId;
    const others = drafts.filter((listed) => listed.id !== draftId);
    const actions = [
      {
        id: "review-draft",
        label: "Review and publish",
        aliases: ["Publish", "Deploy", "Go live", "Push to production", "Ship"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openReviewDraftSheet" }),
      },
      {
        id: "delete-draft",
        label: unnamed ? "Discard changes…" : "Delete draft…",
        aliases: unnamed
          ? ["Delete draft", "Throw away changes", "Revert changes"]
          : ["Discard changes", "Throw away changes", "Revert changes"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openDeleteDraftDialog" }),
      },
      {
        id: "rename-draft",
        label: unnamed ? "Name draft…" : "Rename draft…",
        aliases: unnamed ? ["Rename draft", "Save draft"] : ["Name draft"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openReviewDraftSheet", startRenaming: true }),
      },
      {
        id: "switch-to-live",
        label: "Switch to Live",
        aliases: ["Leave draft", "Exit draft", "Production", "Public website"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
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
      ...others.map((other): Action => ({
        id: `${SWITCH_TO_DRAFT_ID}-${other.id}`,
        parentActionId: SWITCH_TO_DRAFT_ID,
        label: `Switch to "${draftLabel(other)}"`,
        aliases: [other.createdBy.name],
        groupLabel: "Drafts",
        checkIfAvailable: () => true,
        execute: () => switchTo(other.id),
      })),
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });
    return () => {
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((a) => a.id) });
    };
  }, [enabled, draftId, unnamed, drafts, switchTo]);
}

/** Who published Live last and when: a member, a release, or nobody yet. */
function liveLine(live: DraftList["live"] | undefined): string {
  if (!live?.publishedAt) return "Never published";
  const by = live.publishedBy ? live.publishedBy.name : "a release";
  return `Published ${timeAgo(live.publishedAt)} by ${by}`;
}

/** A draft to switch to. */
function DraftItem({ draft }: { draft: DraftSummary }) {
  return (
    <DropdownMenuRadioItem value={draft.id} closeOnClick>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{draftLabel(draft)}</span>
        <span className="text-muted-foreground text-xs">
          {draft.createdBy.name} · {timeAgo(draft.createdAt)} ·{" "}
          {plural(draft.changeCount, "change")}
        </span>
      </div>
    </DropdownMenuRadioItem>
  );
}
