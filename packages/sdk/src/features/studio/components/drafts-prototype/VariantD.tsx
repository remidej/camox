/**
 * PROTOTYPE (#203), throwaway. Variant D, "Picker + review modal": A's draft
 * dropdown, with an outline trigger and a double chevron, moves to the right of
 * the navbar, grouped with an outline "Review changes" button. A new
 * draft is announced by a toast, and reviewing opens a two-column modal:
 * insights on the left, the raw list of changes on the right.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@camox/ui/dialog";
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
import { Check, ChevronsUpDown, Link2Off, Pencil, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  BlockerRow,
  ChangeRow,
  ConflictRow,
  CreatorLine,
  LostRow,
  TOASTER_ID,
  discard,
  useDrafts,
  usePublish,
} from "./shared";
import { type Draft, draftLabel, draftsStore, groupByPage, timeAgo } from "./store";

export const name = "Picker + review modal";

/** Nothing next to the project menu: the picker lives on the right. */
export function Left() {
  return null;
}

export function Right() {
  const { draft, startedDraftId } = useDrafts();
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

  return (
    <>
      <ButtonGroup>
        <DraftPicker />
        {draft && (
          <Button
            variant="outline"
            onClick={publish.openReview}
            disabled={draft.changes.length === 0}
          >
            Review changes
            <span className="bg-muted text-muted-foreground rounded px-1 text-xs tabular-nums">
              {draft.changes.length}
            </span>
          </Button>
        )}
      </ButtonGroup>

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

function Dot({ live }: { live: boolean }) {
  return (
    <span className={cn("size-2 shrink-0 rounded-full", live ? "bg-green-500" : "bg-amber-500")} />
  );
}

/** A's dropdown, behind an outline trigger with a double chevron. */
function DraftPicker() {
  const { drafts, current, draft, live } = useDrafts();
  const development = drafts.filter((d) => d.development);
  const regular = drafts.filter((d) => !d.development);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="gap-2" />}>
        <Dot live={!draft} />
        <span className="max-w-48 truncate">{draft ? draftLabel(draft) : "Live"}</span>
        <ChevronsUpDown className="shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(id) => draftsStore.send({ type: "select", id: id as string })}
        >
          <DropdownMenuRadioItem value="live">
            <div className="flex flex-col">
              <span className="flex items-center gap-2">
                <Dot live /> Live
              </span>
              <span className="text-muted-foreground text-xs">
                Published {timeAgo(live.publishedAt)} by {live.publishedBy}
              </span>
            </div>
          </DropdownMenuRadioItem>
          {development.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Your code</DropdownMenuLabel>
                {development.map((d) => (
                  <DraftItem key={d.id} draft={d} />
                ))}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Drafts ({regular.length})</DropdownMenuLabel>
            {regular.map((d) => (
              <DraftItem key={d.id} draft={d} />
            ))}
            {regular.length === 0 && (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">
                No drafts. Edit Live to start one.
              </p>
            )}
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftItem({ draft }: { draft: Draft }) {
  return (
    <DropdownMenuRadioItem value={draft.id}>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <Dot live={false} />
          <span className="truncate">{draftLabel(draft)}</span>
        </span>
        <CreatorLine draft={draft} />
      </div>
    </DropdownMenuRadioItem>
  );
}

/** D's review modal and discard confirmation; variant E reuses them. */
export function ReviewDialogs({
  draft,
  publish,
  discarding,
  setDiscarding,
}: {
  draft: Draft;
  publish: ReturnType<typeof usePublish>;
  discarding: boolean;
  setDiscarding: (discarding: boolean) => void;
}) {
  return (
    <>
      <Dialog open={publish.open} onOpenChange={publish.setOpen}>
        <DialogContent className="flex h-[min(42rem,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-5xl">
          <div className="border-b p-4 pr-12">
            <DialogTitle>
              <DraftName draft={draft} />
            </DialogTitle>
            <DialogDescription render={<div />}>
              <CreatorLine draft={draft} />
            </DialogDescription>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-10 px-4">
            <Insights draft={draft} publish={publish} />
            <div className="min-h-0 space-y-4 overflow-y-auto py-4">
              <h3 className="text-sm font-medium">
                {draft.changes.length} change{draft.changes.length === 1 ? "" : "s"}
              </h3>
              {groupByPage(draft.changes).map(([page, changes]) => (
                <section key={page}>
                  <h4 className="mb-1 font-mono text-xs font-medium">{page}</h4>
                  <ul className="divide-y">
                    {changes.map((c) => (
                      <ChangeRow key={c.id} change={{ ...c, dangling: undefined }} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t p-4">
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setDiscarding(true)}
            >
              <Trash2 />
              Discard draft
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">
              {publish.conflicts.length > 0 &&
                `Overwrites ${publish.conflicts.length} newer Live change${publish.conflicts.length === 1 ? "" : "s"}`}
            </span>
            <Button
              disabled={publish.pending || publish.blockers.length > 0}
              onClick={publish.publish}
            >
              {publish.pending ? "Publishing…" : "Publish all"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard “{draftLabel(draft)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft and its {draft.changes.length} changes are deleted for everyone. Live stays
              as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                publish.setOpen(false);
                discard(draft);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The left column: what publishing will do beyond applying the changes. */
function Insights({ draft, publish }: { draft: Draft; publish: ReturnType<typeof usePublish> }) {
  const dangling = draft.changes.filter((c) => c.dangling);
  const allClear =
    publish.blockers.length === 0 &&
    publish.conflicts.length === 0 &&
    draft.lost.length === 0 &&
    dangling.length === 0;

  return (
    <div className="min-h-0 space-y-4 overflow-y-auto py-4">
      <h3 className="text-sm font-medium">Before you publish</h3>
      {publish.staleNotice && (
        <p role="alert" className="rounded-md bg-amber-500/10 p-2 text-sm text-amber-800">
          {publish.staleNotice}
        </p>
      )}
      {allClear && (
        <p className="flex items-center gap-2 text-sm">
          <Check className="size-4 text-green-600" />
          Nothing on Live changed since this draft did. Publishing applies the changes as they are.
        </p>
      )}
      {publish.blockers.length > 0 && (
        <Block title="Can't publish yet" tone="red">
          {publish.blockers.map((b) => (
            <BlockerRow key={b} blocker={b} />
          ))}
        </Block>
      )}
      {publish.conflicts.length > 0 && (
        <Block title="Live changed since this draft did" tone="amber">
          {publish.conflicts.map((c) => (
            <ConflictRow key={c.id} conflict={c} />
          ))}
        </Block>
      )}
      {draft.lost.length > 0 && (
        <Block title="These changes will be lost" tone="amber">
          {draft.lost.map((l) => (
            <LostRow key={l.id} lost={l} />
          ))}
        </Block>
      )}
      {dangling.length > 0 && (
        <Block title="References that will read as empty" tone="amber">
          {dangling.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-1 text-sm">
              <Link2Off className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span>
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground"> on {c.page}</span>
                <span className="text-muted-foreground"> — {c.dangling}</span>
              </span>
            </li>
          ))}
        </Block>
      )}
    </div>
  );
}

function Block({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "red" | "amber";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-md border p-3",
        tone === "red"
          ? "border-destructive/30 bg-destructive/5"
          : "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ul>{children}</ul>
    </section>
  );
}

/** The draft's name, renamed in place: the toast no longer asks for one. */
function DraftName({ draft }: { draft: Draft }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(draft.name ?? "");

  if (draft.development) return <>{draftLabel(draft)}</>;

  if (!editing) {
    return (
      <button
        type="button"
        className="group flex items-center gap-2 text-left"
        onClick={() => {
          setValue(draft.name ?? "");
          setEditing(true);
        }}
      >
        {draftLabel(draft)}
        <Pencil className="text-muted-foreground size-3.5 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  const commit = () => {
    draftsStore.send({ type: "rename", id: draft.id, name: value });
    setEditing(false);
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder="Name this draft (optional)"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setEditing(false);
      }}
      className="w-full bg-transparent outline-none"
    />
  );
}
