import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Input } from "@camox/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@camox/ui/popover";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { type DraftSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import { plural } from "../draftLabel";
import { studioStore } from "../studioStore";
import { useDrafts } from "./DraftsControl";
import { useRenameDraft } from "./ReviewDraftSheet";

/**
 * How long a draft goes without a change before the bar shows, so it doesn't pop up mid-edit.
 */
export const SETTLE_MS = 1500;

/**
 * Asks what to do with an unnamed draft, which only editing on Live starts: discard its
 * changes, keep it as a draft by naming it, or publish it. It stays up until one of them ends
 * the draft or names it, and stands in for the navbar's pending changes until then.
 */
export function UnnamedDraftBar({ stacked }: { stacked: boolean }) {
  const { projectId, current } = useDrafts();
  const unnamed = current?.name === null ? current : null;
  const keeping = useSelector(studioStore, (state) => state.context.isKeepDraftOpen);
  const settled = useSettled(unnamed?.id ?? null, unnamed?.lastChangedAt ?? null);

  if (!projectId || !unnamed || !(settled || keeping)) return null;
  const empty = unnamed.changeCount === 0;

  return (
    <FloatingToolbar
      aria-label="Unnamed draft"
      className={cn(
        // Fixed, so it centers on the viewport like the Preview's toolbar, above it when shown.
        "animate-in fade-in slide-in-from-bottom-4 fixed w-max gap-1 duration-300",
        stacked ? "bottom-16" : "bottom-2",
      )}
    >
      <span className="flex items-center gap-2 px-2 text-sm">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-blue-500" />
        {empty ? "No changes yet" : plural(unnamed.changeCount, "pending change")}
      </span>
      <ButtonGroup aria-label="Draft actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => studioStore.send({ type: "openDeleteDraftDialog" })}
        >
          Discard
        </Button>
        <KeepDraft projectId={projectId} draft={unnamed} open={keeping} disabled={empty} />
        <Button
          type="button"
          variant="outline"
          disabled={empty}
          onClick={() => studioStore.send({ type: "openReviewDraftSheet" })}
        >
          Publish…
        </Button>
      </ButtonGroup>
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

/** "Keep as draft": names the draft, which keeps it and ends the bar. */
function KeepDraft({
  projectId,
  draft,
  open,
  disabled,
}: {
  projectId: number;
  draft: DraftSummary;
  open: boolean;
  disabled: boolean;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={(next) => studioStore.send({ type: next ? "openKeepDraft" : "closeKeepDraft" })}
    >
      <PopoverTrigger
        disabled={disabled}
        render={<Button type="button" variant="outline" disabled={disabled} />}
      >
        Keep as draft
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={16} className="w-80">
        {open && <KeepDraftForm projectId={projectId} draft={draft} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The name to keep the draft under, filled with the short name its Draft Overview suggests until
 * the editor types: AI names a few changes well, and better than a name typed before making them.
 */
function KeepDraftForm({ projectId, draft }: { projectId: number; draft: DraftSummary }) {
  // Reading the review asks for an overview the draft lacks, rather than wait for its debounce.
  const preview = useReadQuery(reads.publishPreview({ projectId, draftId: draft.id }));
  const overview = preview.data?.overview;
  const suggested = overview?.status === "ready" ? overview.name : null;
  const summarizing = !suggested && (preview.isPending || overview?.status === "pending");
  const [typed, setTyped] = React.useState<string | null>(null);
  const name = typed ?? suggested ?? "";
  const rename = useRenameDraft(projectId);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const kept = name.trim();
        if (!kept) return;
        rename.mutate(
          { draftId: draft.id, name: kept },
          {
            onSuccess: () => {
              studioStore.send({ type: "closeKeepDraft" });
              toast.success(`Kept as "${kept}"`);
            },
          },
        );
      }}
    >
      <PopoverHeader>
        <PopoverTitle>Keep as draft</PopoverTitle>
        <PopoverDescription>
          Name it for what it changes, so you and your team can find it later.
        </PopoverDescription>
      </PopoverHeader>
      <Input
        autoFocus
        aria-label="Draft name"
        value={name}
        maxLength={200}
        placeholder={summarizing ? "Summarizing your changes…" : "What does this draft change?"}
        onChange={(event) => setTyped(event.target.value)}
      />
      <Button type="submit" disabled={!name.trim() || rename.isPending}>
        {rename.isPending ? <Spinner /> : null}
        Keep draft
      </Button>
    </form>
  );
}
