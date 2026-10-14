/**
 * PROTOTYPE (#203), throwaway. Variant C, "Mode chrome + command picker": the
 * whole studio is tinted by what you're viewing, the picker is a searchable
 * command list, a new draft pops a naming callout from the picker, and
 * publishing is a wide two-column review: changes left, checks right.
 */
import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@camox/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { Input } from "@camox/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Lock,
  Trash2,
  XCircle,
} from "lucide-react";
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

export const name = "Mode chrome + command picker";

function ModePill({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider",
        live
          ? "bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      )}
    >
      {live ? "LIVE" : "DRAFT"}
    </span>
  );
}

export function Left() {
  const { startedDraftId } = useDrafts();
  const [started, setStarted] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    if (!startedDraftId) return;
    setStarted(
      draftsStore.getSnapshot().context.drafts.find((d) => d.id === startedDraftId) ?? null,
    );
    draftsStore.send({ type: "acknowledgeStarted" });
  }, [startedDraftId]);

  return (
    <>
      <DraftPicker align="start" liveLabel="Published site" />
      {/* Anchored callout under the picker when an edit started a draft. */}
      {started && <StartedCallout draft={started} onClose={() => setStarted(null)} />}
    </>
  );
}

/** The searchable draft picker; variant D reuses it on the right. */
export function DraftPicker({
  align,
  liveLabel,
  className,
}: {
  align: "start" | "end";
  liveLabel: string;
  className?: string;
}) {
  const { drafts, current, draft, live } = useDrafts();
  const [open, setOpen] = React.useState(false);

  const select = (id: string) => {
    draftsStore.send({ type: "select", id });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className={cn("gap-2", className)} />}>
        <ModePill live={!draft} />
        <span className="max-w-48 truncate">{draft ? draftLabel(draft) : liveLabel}</span>
        <ChevronsUpDown className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align={align}>
        <Command>
          <CommandInput placeholder="Find a draft…" />
          <CommandList>
            <CommandEmpty>No draft found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`live ${liveLabel}`} onSelect={() => select("live")}>
                <ModePill live />
                <div className="flex flex-col">
                  <span>{liveLabel}</span>
                  <span className="text-muted-foreground text-xs">
                    {live.publishedBy} published {timeAgo(live.publishedAt)}
                  </span>
                </div>
                {current === "live" && <Check className="ml-auto" />}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={`Open drafts · ${drafts.length}`}>
              {drafts.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.id} ${draftLabel(d)} ${d.creator.name}`}
                  onSelect={() => select(d.id)}
                >
                  <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
                    {d.creator.name.slice(0, 1)}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{draftLabel(d)}</span>
                    <CreatorLine draft={d} />
                  </div>
                  {current === d.id && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          Drafts start on their own: edit {liveLabel === "Live" ? "Live" : "the published site"} and
          your change lands in a new draft.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function StartedCallout({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [value, setValue] = React.useState("");
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-44 z-40 mt-2 w-80 rounded-lg border p-3 shadow-lg">
      <div className="absolute -top-1.5 left-10 size-3 rotate-45 border-t border-l bg-inherit" />
      <p className="text-sm font-medium">You started a draft</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        The published site can't be edited directly, so your change is in a new draft. Others can
        see it, but visitors won't until you publish.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          draftsStore.send({ type: "rename", id: draft.id, name: value });
          onClose();
        }}
      >
        <Input
          autoFocus
          value={value}
          placeholder={draftLabel(draft)}
          onChange={(event) => setValue(event.target.value)}
          className="h-8"
        />
        <Button size="sm" type="submit">
          {value ? "Name it" : "Skip"}
        </Button>
      </form>
    </div>
  );
}

export function Right() {
  const { draft } = useDrafts();
  const publish = usePublish(draft);

  if (!draft) {
    return (
      <span className="flex items-center gap-1 rounded-md border border-green-500/30 px-2 py-1 text-xs text-green-700 dark:text-green-400">
        <Lock className="size-3" /> Read-only
      </span>
    );
  }

  const checks = [
    {
      ok: publish.blockers.length === 0,
      label: publish.blockers.length === 0 ? "No duplicate paths" : "Blocked",
      blocking: true,
      body: publish.blockers.map((b) => <BlockerRow key={b} blocker={b} />),
    },
    {
      ok: publish.conflicts.length === 0,
      label:
        publish.conflicts.length === 0
          ? "Nothing newer on Live"
          : `${publish.conflicts.length} newer on Live, will be overwritten`,
      body: publish.conflicts.map((c) => <ConflictRow key={c.id} conflict={c} />),
    },
    {
      ok: draft.lost.length === 0,
      label: draft.lost.length === 0 ? "Nothing lost" : `${draft.lost.length} change won't publish`,
      body: draft.lost.map((l) => <LostRow key={l.id} lost={l} />),
    },
  ];

  return (
    <>
      <ButtonGroup>
        <Button onClick={publish.openReview} disabled={draft.changes.length === 0}>
          Publish
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon" aria-label="More" />}>
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => discard(draft)}>
              <Trash2 /> Discard draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      <Dialog open={publish.open} onOpenChange={publish.setOpen}>
        <DialogContent className="flex h-[min(40rem,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-4xl">
          <DialogHeader className="border-b p-4">
            <DialogTitle>Publish {draftLabel(draft)}</DialogTitle>
            <DialogDescription>
              Everything below replaces what's on the published site, in one go.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_20rem]">
            <div className="min-h-0 space-y-4 overflow-y-auto p-4">
              {groupByPage(draft.changes).map(([page, changes]) => (
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
            <aside className="bg-muted/40 flex min-h-0 flex-col border-l">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <h3 className="text-sm font-medium">Before you publish</h3>
                {publish.staleNotice && (
                  <p role="alert" className="text-xs font-medium text-amber-700">
                    {publish.staleNotice}
                  </p>
                )}
                {checks.map((check) => (
                  <details key={check.label} open={!check.ok} className="group">
                    <summary className="flex cursor-default list-none items-center gap-2 text-sm">
                      {check.ok ? (
                        <Check className="size-4 text-green-600" />
                      ) : check.blocking ? (
                        <XCircle className="text-destructive size-4" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-600" />
                      )}
                      {check.label}
                    </summary>
                    {!check.ok && <ul className="mt-1 pl-1">{check.body}</ul>}
                  </details>
                ))}
              </div>
              <div className="border-t p-4">
                <Button
                  className="w-full"
                  variant={publish.conflicts.length > 0 ? "destructive" : "default"}
                  disabled={publish.pending || publish.blockers.length > 0}
                  onClick={publish.publish}
                >
                  {publish.pending ? "Publishing…" : `Publish ${draft.changes.length} changes`}
                </Button>
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A coloured rule across the top of the studio: green on Live, amber in a draft. */
export function Banner() {
  const { draft } = useDrafts();
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 h-1",
        draft ? "bg-amber-500" : "bg-green-500",
      )}
    />
  );
}
