/**
 * PROTOTYPE (#203), throwaway. Variant A, "Dropdown + split button": the
 * environment badge becomes a draft dropdown, a toast announces a new draft,
 * and publishing confirms in one stacked alert dialog.
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@camox/ui/dialog";
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
import { Input } from "@camox/ui/input";
import { toast } from "@camox/ui/toaster";
import { ChevronDown, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { type Draft, draftLabel, draftsStore, timeAgo } from "./store";

export const name = "Dropdown + split button";

function Dot({ live }: { live: boolean }) {
  return (
    <span className={cn("size-2 shrink-0 rounded-full", live ? "bg-green-500" : "bg-amber-500")} />
  );
}

export function Left() {
  const { drafts, current, draft, live, startedDraftId } = useDrafts();
  const [renaming, setRenaming] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    if (!startedDraftId) return;
    const started = draftsStore.getSnapshot().context.drafts.find((d) => d.id === startedDraftId);
    draftsStore.send({ type: "acknowledgeStarted" });
    if (!started) return;
    toast.success("Started a new draft", {
      toasterId: TOASTER_ID,
      description: `Your change is saved in “${draftLabel(started)}”, not on Live.`,
      action: { label: "Name it", onClick: () => setRenaming(started) },
    });
  }, [startedDraftId]);

  const development = drafts.filter((d) => d.development);
  const regular = drafts.filter((d) => !d.development);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="gap-2" />}>
          <Dot live={!draft} />
          <span className="max-w-48 truncate">{draft ? draftLabel(draft) : "Live"}</span>
          <ChevronDown className="shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start">
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
      {renaming && <RenameDialog draft={renaming} onClose={() => setRenaming(null)} />}
    </>
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

export function Right() {
  const { draft } = useDrafts();
  const publish = usePublish(draft);
  const [renaming, setRenaming] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);

  if (!draft) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-sm">
        <Lock className="size-3.5" />
        Live is read-only · editing starts a draft
      </span>
    );
  }

  return (
    <>
      <ButtonGroup>
        <Button onClick={publish.openReview} disabled={draft.changes.length === 0}>
          Publish
          {draft.changes.length > 0 && (
            <span className="bg-primary-foreground/20 rounded px-1 text-xs">
              {draft.changes.length}
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon" aria-label="Draft actions" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!draft.development && (
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <Pencil /> Rename draft
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => setDiscarding(true)}>
              <Trash2 /> Discard draft…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      {renaming && <RenameDialog draft={draft} onClose={() => setRenaming(false)} />}

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard “{draftLabel(draft)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {draft.changes.length} changes are deleted for everyone. Live stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => discard(draft)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={publish.open} onOpenChange={publish.setOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish “{draftLabel(draft)}” to Live?</AlertDialogTitle>
            <AlertDialogDescription>
              All {draft.changes.length} changes go live at once, and the draft closes. Live's
              previous content is not kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto">
            {publish.staleNotice && (
              <p role="alert" className="text-sm font-medium text-amber-700">
                {publish.staleNotice}
              </p>
            )}
            {publish.blockers.length > 0 && (
              <Section title="Fix before publishing">
                {publish.blockers.map((b) => (
                  <BlockerRow key={b} blocker={b} />
                ))}
              </Section>
            )}
            {publish.conflicts.length > 0 && (
              <Section title={`Overwrites ${publish.conflicts.length} newer Live changes`}>
                {publish.conflicts.map((c) => (
                  <ConflictRow key={c.id} conflict={c} />
                ))}
              </Section>
            )}
            {draft.lost.length > 0 && (
              <Section title="Won't be published">
                {draft.lost.map((l) => (
                  <LostRow key={l.id} lost={l} />
                ))}
              </Section>
            )}
            <Section title="Changes">
              {draft.changes.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </Section>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" disabled={publish.pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant={publish.conflicts.length > 0 ? "destructive" : "default"}
              disabled={publish.pending || publish.blockers.length > 0}
              onClick={(event) => {
                event.preventDefault();
                publish.publish();
              }}
            >
              {publish.pending
                ? "Publishing…"
                : publish.conflicts.length > 0
                  ? "Overwrite and publish"
                  : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function RenameDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [value, setValue] = React.useState(draft.name ?? "");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Name this draft</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            draftsStore.send({ type: "rename", id: draft.id, name: value });
            onClose();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            value={value}
            placeholder={`${draft.creator.name}'s draft`}
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
