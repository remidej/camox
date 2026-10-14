/**
 * PROTOTYPE (#203), throwaway. Variant B, "Tabs + review sheet": drafts are
 * browser-like tabs next to the project menu, Live carries a banner, a new
 * draft opens as a tab with its name field focused, and publishing is a
 * review sheet with a sticky footer.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@camox/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { Bot, Code, Eye, Globe, Lock, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  BlockerRow,
  ChangeRow,
  ConflictRow,
  CreatorLine,
  LostRow,
  discard,
  useDrafts,
  usePublish,
} from "./shared";
import { type Draft, draftLabel, draftsStore, groupByPage, timeAgo } from "./store";

export const name = "Tabs + review sheet";

const VISIBLE_TABS = 2;

export function Left() {
  const { drafts, current, startedDraftId, live } = useDrafts();
  const [editingName, setEditingName] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!startedDraftId) return;
    setEditingName(startedDraftId);
    draftsStore.send({ type: "acknowledgeStarted" });
  }, [startedDraftId]);

  // Keep the current draft visible even when it's beyond the visible tabs.
  const visible = drafts.slice(0, VISIBLE_TABS);
  const currentDraft = drafts.find((d) => d.id === current);
  if (currentDraft && !visible.includes(currentDraft)) visible.push(currentDraft);
  const overflow = drafts.filter((d) => !visible.includes(d));

  return (
    <div className="flex items-center gap-0.5">
      <Tab
        active={current === "live"}
        onClick={() => draftsStore.send({ type: "select", id: "live" })}
        tooltip={`Published ${timeAgo(live.publishedAt)} by ${live.publishedBy}`}
      >
        <Globe className="size-3.5 text-green-600" />
        Live
      </Tab>
      <span className="bg-border mx-1 h-5 w-px" />
      {visible.map((draft) => (
        <Tab
          key={draft.id}
          active={current === draft.id}
          onClick={() => draftsStore.send({ type: "select", id: draft.id })}
          tooltip={<CreatorLine draft={draft} className="text-inherit" />}
        >
          {draft.development ? (
            <Code className="size-3.5" />
          ) : draft.creator.kind === "agent" ? (
            <Bot className="size-3.5" />
          ) : null}
          {editingName === draft.id ? (
            <NameInput draft={draft} onDone={() => setEditingName(null)} />
          ) : (
            <span
              className="max-w-36 truncate"
              onDoubleClick={() => !draft.development && setEditingName(draft.id)}
            >
              {draftLabel(draft)}
            </span>
          )}
          <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] tabular-nums">
            {draft.changes.length}
          </span>
        </Tab>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="text-xs" />}>
            +{overflow.length} more
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {overflow.map((draft) => (
              <DropdownMenuItem
                key={draft.id}
                onClick={() => draftsStore.send({ type: "select", id: draft.id })}
              >
                <div className="flex flex-col">
                  <span>{draftLabel(draft)}</span>
                  <CreatorLine draft={draft} />
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  tooltip,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tooltip: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-md px-3 text-sm",
              active
                ? "bg-accent text-foreground font-medium shadow-[inset_0_-2px_0_0_var(--color-amber-500)]"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function NameInput({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [value, setValue] = React.useState(draft.name ?? "");
  const commit = () => {
    draftsStore.send({ type: "rename", id: draft.id, name: value });
    onDone();
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
        if (event.key === "Escape") onDone();
      }}
      onClick={(event) => event.stopPropagation()}
      className="w-44 bg-transparent outline-none placeholder:text-amber-700/70"
    />
  );
}

export function Right() {
  const { draft } = useDrafts();
  const publish = usePublish(draft);
  const [discarding, setDiscarding] = React.useState(false);

  if (!draft) return null;

  const groups = groupByPage(draft.changes);

  return (
    <>
      <Button onClick={publish.openReview} disabled={draft.changes.length === 0}>
        <Eye />
        Review & publish
      </Button>

      <Sheet open={publish.open} onOpenChange={publish.setOpen}>
        <SheetContent side="right" className="flex w-[28rem] flex-col gap-0 p-0 sm:max-w-[28rem]">
          <SheetHeader className="border-b">
            <SheetTitle>{draftLabel(draft)}</SheetTitle>
            <SheetDescription>
              <CreatorLine draft={draft} />
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {publish.staleNotice && (
              <p role="alert" className="rounded-md bg-amber-500/10 p-2 text-sm text-amber-800">
                {publish.staleNotice}
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
            {groups.map(([page, changes]) => (
              <section key={page}>
                <h3 className="mb-1 font-mono text-xs font-medium">{page}</h3>
                <ul className="divide-y">
                  {changes.map((c) => (
                    <ChangeRow key={c.id} change={c} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <SheetFooter className="flex-row items-center gap-2 border-t">
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setDiscarding(true)}
            >
              <Trash2 />
              Discard
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">
              {draft.changes.length} changes
              {publish.conflicts.length > 0 && `, ${publish.conflicts.length} overwrite Live`}
            </span>
            <Button
              disabled={publish.pending || publish.blockers.length > 0}
              onClick={publish.publish}
            >
              {publish.pending ? "Publishing…" : "Publish all"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard “{draftLabel(draft)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft and its {draft.changes.length} changes are deleted for everyone.
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
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

/** Rendered under the navbar: Live says it's read-only. */
export function Banner() {
  const { draft } = useDrafts();
  if (draft) return null;
  return (
    <div className="absolute inset-x-0 top-full z-20 flex items-center justify-center gap-2 border-b border-green-500/30 bg-green-50 py-1 text-xs text-green-800 dark:bg-green-950 dark:text-green-300">
      <Lock className="size-3" />
      You're viewing Live. It's read-only: your first edit starts a new draft.
    </div>
  );
}
