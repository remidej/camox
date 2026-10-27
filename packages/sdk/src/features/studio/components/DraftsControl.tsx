import { Badge } from "@camox/ui/badge";
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
import { ChevronsUpDown, Pencil } from "lucide-react";
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
import { RenameDraftDialog } from "./RenameDraftDialog";
import { DeleteDraftDialog, ReviewDraftSheet, useLeaveDraft } from "./ReviewDraftSheet";

const LIVE = "live";
const SWITCH_TO_DRAFT_ID = "switch-to-draft";

/** What the drafts controls read: the project, the current draft, and the drafts to switch to. */
function useDrafts() {
  const draftScope = useDraftScope();
  const draftId = useCurrentDraftId();
  const authCtx = React.useContext(AuthContext);
  const developmentMode = draftScope.developmentMode;
  const project = useReadQuery(reads.project({ projectUuid: authCtx?.projectUuid ?? "" }), {
    enabled: !!authCtx?.projectUuid,
  });
  const projectId = project.data?.id;
  const list = useReadQuery(reads.draftList({ projectId: projectId ?? 0 }), {
    enabled: !!projectId && !developmentMode,
  });
  const draft = useReadQuery(reads.draft({ projectId: projectId ?? 0, draftId: draftId ?? "" }), {
    enabled: !!projectId && !!draftId,
  });
  return {
    draftScope,
    draftId,
    developmentMode,
    projectId,
    list: list.data,
    current: draftId ? draft.data : undefined,
  };
}

/**
 * Picks what the studio is viewing, Live or a draft (#203). Live is read-only; the first edit
 * starts a draft. The localhost studio works only in the development draft, so it shows that
 * draft alone, with nothing to switch to (ADR 0006). The command palette offers the same actions,
 * and the picker hosts the draft's review and delete confirmation they open. A `disabled` picker
 * still names what the studio is viewing.
 */
export function DraftPicker({ disabled = false }: { disabled?: boolean }) {
  const { draftScope, draftId, developmentMode, projectId, list, current } = useDrafts();
  const navigate = useNavigate();
  const leaveDraft = useLeaveDraft();
  const review = useSelector(studioStore, (state) => state.context.reviewDraftSheet);
  const deleting = useSelector(studioStore, (state) => state.context.isDeleteDraftDialogOpen);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<DraftSummary | null>(null);

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

  const drafts = list?.drafts;
  // The hosted studio never lists development drafts (ADR 0011).
  const regular = React.useMemo(
    () => (drafts ?? []).filter((listed) => listed.kind === "regular"),
    [drafts],
  );

  /** Views the same page in another draft, or in Live when `next` is null. */
  const switchTo = React.useCallback(
    (next: string | null) => {
      if (next === draftId) return;
      void navigate({ to: window.location.href, draft: next });
    },
    [draftId, navigate],
  );

  useDraftsActions({ enabled: !!projectId, draftId, developmentMode, regular, switchTo });

  // Without its development draft, the localhost studio has nothing to show or switch to.
  if (developmentMode && !draftId) return null;
  // Live and the development draft read the same however their data loads, so they show at
  // once. A regular draft's label needs its name, so it waits rather than flash a placeholder.
  if (draftId && !developmentMode && !current) return null;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" />}>
          {/* Green on Live, blue in a draft. */}
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              draftId ? "bg-blue-500" : "bg-emerald-500",
            )}
          />
          <span className="max-w-48 truncate">
            {!draftId ? "Live" : developmentMode ? "Development draft" : draftLabel(current!)}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start">
          {developmentMode ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                The localhost studio works in your development draft.
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          ) : (
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
                  {regular.map((listed) => (
                    <DraftItem
                      key={listed.id}
                      draft={listed}
                      onRename={() => {
                        setMenuOpen(false);
                        setRenaming(listed);
                      }}
                    />
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {projectId && (
        <RenameDraftDialog
          projectId={projectId}
          draft={renaming}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
        />
      )}
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
            onOpenChange={(open) => {
              if (!open) studioStore.send({ type: "closeDeleteDraftDialog" });
            }}
            onDeleted={leaveDraft}
          />
        </>
      )}
    </>
  );
}

/**
 * The current draft's pending changes, which open its review to publish or delete them. Live
 * has none, so it shows nothing there.
 */
export function PendingChanges() {
  const { current } = useDrafts();
  if (!current) return null;

  return (
    <Button
      type="button"
      aria-label={`Review ${plural(current.changeCount, "change")}`}
      onClick={() => studioStore.send({ type: "openReviewDraftSheet" })}
    >
      Review changes
      <Badge className="bg-primary-foreground/20 text-primary-foreground min-w-5 px-1.5 tabular-nums">
        {current.changeCount}
      </Badge>
    </Button>
  );
}

/**
 * The drafts controls' actions in the command palette, offered where the controls offer them. The palette only opens the review and the delete confirmation; it never publishes or
 * deletes by itself.
 */
function useDraftsActions({
  enabled,
  draftId,
  developmentMode,
  regular,
  switchTo,
}: {
  enabled: boolean;
  draftId: string | null;
  developmentMode: boolean;
  regular: DraftSummary[];
  switchTo: (next: string | null) => void;
}) {
  React.useEffect(() => {
    const inDraft = enabled && !!draftId;
    const others = regular.filter((listed) => listed.id !== draftId);
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
        label: "Delete draft…",
        aliases: ["Delete draft", "Throw away changes", "Revert changes"],
        groupLabel: "Drafts",
        checkIfAvailable: () => inDraft,
        execute: () => studioStore.send({ type: "openDeleteDraftDialog" }),
      },
      {
        id: "rename-draft",
        label: "Rename draft…",
        aliases: ["Name draft"],
        groupLabel: "Drafts",
        // Only a regular draft has a name.
        checkIfAvailable: () => inDraft && !developmentMode,
        execute: () => studioStore.send({ type: "openReviewDraftSheet", startRenaming: true }),
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
  }, [enabled, draftId, developmentMode, regular, switchTo]);
}

/** Who published Live last and when: a member, a release, or nobody yet. */
function liveLine(live: DraftList["live"] | undefined): string {
  if (!live?.publishedAt) return "Never published";
  const by = live.publishedBy ? live.publishedBy.name : "a release";
  return `Published ${timeAgo(live.publishedAt)} by ${by}`;
}

/** A draft to switch to, with a button to rename it that leaves the selection alone. */
function DraftItem({ draft, onRename }: { draft: DraftSummary; onRename: () => void }) {
  // Kept from the item, which would switch to the draft and close the menu.
  const keep = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <DropdownMenuRadioItem value={draft.id} closeOnClick className="group/draft-item">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{draftLabel(draft)}</span>
        <span className="text-muted-foreground text-xs">
          {draft.createdBy.name} · {timeAgo(draft.createdAt)} ·{" "}
          {plural(draft.changeCount, "change")}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Rename "${draftLabel(draft)}"`}
        className="opacity-0 group-data-highlighted/draft-item:opacity-100 focus-visible:opacity-100"
        onPointerDown={keep}
        onPointerUp={keep}
        onMouseUp={keep}
        onClick={(event) => {
          keep(event);
          onRename();
        }}
      >
        <Pencil />
      </Button>
    </DropdownMenuRadioItem>
  );
}
