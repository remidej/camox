// PROTOTYPE — throwaway. Variants of the draft review sheet, on fake data, switchable with
// `?variant=H|I|A|B|E|F|G` in the studio URL (C and D were dropped after round 1). Question: how should the review sheet tell a member what a
// draft is about and what needs their attention before publishing?
// Mounted by DraftPicker whenever `?variant=` is set; never in production builds.
import { Button } from "@camox/ui/button";
import { Checkbox } from "@camox/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@camox/ui/sheet";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Database,
  Eye,
  FileText,
  GitMerge,
  Image,
  Languages,
  type LucideIcon,
  OctagonX,
  PanelsTopLeft,
  Replace,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { PrototypeSwitcher, usePrototypeVariant } from "./PrototypeSwitcher.prototype";
import {
  changeCount,
  type FieldDiff,
  type PlaceKind,
  type ProtoBlocker,
  type ProtoChange,
  type ProtoOverwrite,
  type ProtoPlace,
  type ProtoScenario,
  SCENARIOS,
  type ScenarioKey,
} from "./ReviewDraftSheet.prototype-data";

// --- Small shared pieces (layout is never shared) ---

const PLACE_ICONS: Record<PlaceKind, LucideIcon> = {
  page: FileText,
  layout: PanelsTopLeft,
  collection: Database,
  files: Image,
  languages: Languages,
};

const KIND_STYLE: Record<ProtoChange["kind"], { label: string; className: string }> = {
  created: { label: "Added", className: "text-green-700 dark:text-green-400" },
  changed: { label: "Edited", className: "text-foreground/70" },
  deleted: { label: "Removed", className: "text-destructive" },
  moved: { label: "Moved", className: "text-foreground/70" },
};

const stub = (what: string) => () => toast.info(`Prototype: would ${what}`);

function Header({ scenario }: { scenario: ProtoScenario }) {
  const { draft } = scenario;
  return (
    <div className="flex flex-col gap-1 border-b p-4 pr-12">
      <SheetTitle className="text-base">{draft.name}</SheetTitle>
      <SheetDescription>
        {draft.startedBy}
        {draft.viaAgent && " with Camox"} · started {draft.startedAgo}
      </SheetDescription>
    </div>
  );
}

function Footer({
  publishDisabled,
  publishLabel = "Publish",
  note,
}: {
  publishDisabled: boolean;
  publishLabel?: string;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t p-4">
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="text-destructive" onClick={stub("discard the draft")}>
          <Trash2 />
          Discard draft
        </Button>
        <Button className="ml-auto" disabled={publishDisabled} onClick={stub("publish")}>
          {publishLabel}
        </Button>
      </div>
    </div>
  );
}

function Diff({ diff }: { diff: { field: string; before?: string; after?: string } }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground truncate">{diff.field}</span>
      <span className="min-w-0">
        {diff.before !== undefined && (
          <>
            <del className="text-muted-foreground decoration-destructive/50">{diff.before}</del>{" "}
            <ArrowRight className="text-muted-foreground inline size-3" />{" "}
          </>
        )}
        <span>{diff.after}</span>
      </span>
    </div>
  );
}

function BeforeAfter({ overwrite }: { overwrite: ProtoOverwrite }) {
  return (
    <div className="grid gap-1.5 text-sm">
      <div className="bg-background rounded-md border px-2.5 py-1.5">
        <p className="text-muted-foreground text-xs">
          On Live now · {overwrite.by}, {overwrite.at}
        </p>
        <p className="text-muted-foreground line-through decoration-amber-500/60">
          {overwrite.live}
        </p>
      </div>
      <div className="bg-background rounded-md border border-amber-500/40 px-2.5 py-1.5">
        <p className="text-muted-foreground text-xs">This draft, what you see</p>
        <p>{overwrite.draft}</p>
      </div>
    </div>
  );
}

const translationLine = (scenario: ProtoScenario) =>
  scenario.translations.status === "done"
    ? `Translated into ${scenario.translations.locales.join(" and ")}`
    : `Translating into ${scenario.translations.locales.join(" and ")}…`;

// --- Variant A: Brief. Summary first, then a short "before you publish", evidence collapsed. ---

function VariantA({ scenario }: { scenario: ProtoScenario }) {
  const blockers = scenario.issues.filter(
    (issue): issue is ProtoBlocker => issue.kind === "blocker",
  );
  const overwrites = scenario.issues.filter(
    (issue): issue is ProtoOverwrite => issue.kind === "overwrite",
  );
  const [showMerges, setShowMerges] = React.useState(false);
  const [showChanges, setShowChanges] = React.useState(false);

  return (
    <>
      <Header scenario={scenario} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <section className="flex flex-col gap-2">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="size-3.5" />
            What this draft does
          </p>
          <p className="text-base leading-snug font-medium">{scenario.summary.headline}</p>
          {scenario.summary.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-foreground/80 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>

        {scenario.issues.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Before you publish</h3>
            {blockers.map((blocker) => (
              <div
                key={blocker.id}
                className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex gap-2">
                  <OctagonX className="text-destructive mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">{blocker.title}</p>
                    <p className="text-muted-foreground">{blocker.detail}</p>
                  </div>
                </div>
                <div className="flex gap-2 pl-6">
                  <Button size="sm" onClick={stub("open the testimonial in the Canvas")}>
                    {blocker.fix}
                  </Button>
                </div>
              </div>
            ))}
            {overwrites.map((overwrite) => (
              <div
                key={overwrite.id}
                className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
              >
                <div className="flex gap-2">
                  <Replace className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="font-medium">
                      Replaces {overwrite.by}'s edit to the {overwrite.title.toLowerCase()}
                    </p>
                    <p className="text-muted-foreground">
                      You both changed it, so it couldn't be merged. Publishing keeps your version.
                    </p>
                  </div>
                </div>
                <div className="pl-6">
                  <BeforeAfter overwrite={overwrite} />
                </div>
                <div className="flex gap-2 pl-6">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={stub(`take ${overwrite.by}'s version into the draft`)}
                  >
                    Use {overwrite.by}'s version instead
                  </Button>
                  <Button size="sm" variant="ghost" onClick={stub("show the hero in the Canvas")}>
                    <Eye />
                    Show
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          {scenario.merges.length > 0 ? (
            <button
              type="button"
              className="hover:text-foreground flex items-center gap-2 text-left"
              onClick={() => setShowMerges(!showMerges)}
            >
              <GitMerge className="size-4 shrink-0" />
              Up to date with Live: {scenario.merges.length} newer changes already merged in
              <ChevronRight
                className={cn("size-3.5 transition-transform", showMerges && "rotate-90")}
              />
            </button>
          ) : (
            <p className="flex items-center gap-2">
              <GitMerge className="size-4 shrink-0" />
              Up to date with Live
            </p>
          )}
          {showMerges && (
            <ul className="flex flex-col gap-1 pl-6">
              {scenario.merges.map((merge) => (
                <li key={merge.id}>
                  {merge.by} · {merge.description.toLowerCase()} ({merge.at})
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-center gap-2">
            <Languages className="size-4 shrink-0" />
            {translationLine(scenario)}
          </p>
        </section>

        <section className="rounded-lg border">
          <button
            type="button"
            className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left"
            onClick={() => setShowChanges(!showChanges)}
          >
            <ChevronRight
              className={cn(
                "text-muted-foreground size-4 transition-transform",
                showChanges && "rotate-90",
              )}
            />
            <span className="font-medium">All changes</span>
            <span className="text-muted-foreground">
              {changeCount(scenario)} in {scenario.places.length} places
            </span>
          </button>
          {showChanges && (
            <div className="flex flex-col gap-4 border-t p-3">
              {scenario.places.map((place) => {
                const Icon = PLACE_ICONS[place.kind];
                return (
                  <div key={place.id} className="flex flex-col gap-1.5">
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                      <Icon className="size-3.5" />
                      {place.name}
                      {place.path && <span className="font-normal">{place.path}</span>}
                    </p>
                    {place.changes.map((change) => (
                      <div key={change.id} className="flex flex-col gap-0.5 pl-5">
                        <p>
                          <span className={KIND_STYLE[change.kind].className}>
                            {KIND_STYLE[change.kind].label}
                          </span>{" "}
                          {change.label}
                        </p>
                        {change.kind !== "created" &&
                          change.diffs.map((diff) => <Diff key={diff.field} diff={diff} />)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Footer
        publishDisabled={blockers.length > 0}
        note={blockers.length > 0 ? "Fix the problem above to publish." : undefined}
      />
    </>
  );
}

// --- Variant B: Checklist. Publishing is a short list of steps to clear. ---

type StepState = "todo" | "done" | "error" | "running" | "info";

function Step({
  state,
  title,
  last,
  children,
}: {
  state: StepState;
  title: React.ReactNode;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const icon = {
    done: <Check className="size-3.5" />,
    error: <OctagonX className="size-3.5" />,
    todo: <CircleAlert className="size-3.5" />,
    running: <Languages className="size-3.5 animate-pulse" />,
    info: <Eye className="size-3.5" />,
  }[state];
  const tone = {
    done: "bg-green-500/15 text-green-700 dark:text-green-400",
    error: "bg-destructive/15 text-destructive",
    todo: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    running: "bg-muted text-muted-foreground",
    info: "bg-muted text-muted-foreground",
  }[state];
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span className="bg-border absolute top-7 bottom-0 left-3 w-px" />}
      <span
        className={cn("z-10 flex size-6 shrink-0 items-center justify-center rounded-full", tone)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <p className={cn("font-medium", state === "done" && "text-foreground/70")}>{title}</p>
        {children}
      </div>
    </li>
  );
}

function VariantB({ scenario }: { scenario: ProtoScenario }) {
  const blockers = scenario.issues.filter(
    (issue): issue is ProtoBlocker => issue.kind === "blocker",
  );
  const overwrites = scenario.issues.filter(
    (issue): issue is ProtoOverwrite => issue.kind === "overwrite",
  );
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [more, setMore] = React.useState(false);
  const [showChanges, setShowChanges] = React.useState(false);
  const pendingOverwrites = overwrites.filter((overwrite) => !accepted.has(overwrite.id));
  const left = blockers.length + pendingOverwrites.length;

  return (
    <>
      <Header scenario={scenario} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <section className="bg-muted/40 flex flex-col gap-1.5 rounded-lg p-3">
          <p className="leading-snug">{scenario.summary.headline}</p>
          {more &&
            scenario.summary.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-foreground/75">
                {paragraph}
              </p>
            ))}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-fit text-xs"
            onClick={() => setMore(!more)}
          >
            {more ? "Less" : "More about this draft"}
          </button>
        </section>

        <ol className="flex flex-col">
          {blockers.length > 0 && (
            <Step
              state="error"
              title={`Fix ${blockers.length === 1 ? "1 problem" : `${blockers.length} problems`}`}
            >
              {blockers.map((blocker) => (
                <div key={blocker.id} className="flex items-center gap-3 rounded-md border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p>{blocker.title}</p>
                    <p className="text-muted-foreground text-xs">Black Friday · /black-friday</p>
                  </div>
                  <Button size="sm" onClick={stub("open the testimonial in the Canvas")}>
                    {blocker.fix}
                  </Button>
                </div>
              ))}
            </Step>
          )}
          {overwrites.length > 0 && (
            <Step
              state={pendingOverwrites.length ? "todo" : "done"}
              title={
                pendingOverwrites.length
                  ? `Confirm ${overwrites.length === 1 ? "1 overwrite" : `${overwrites.length} overwrites`}`
                  : "Overwrites confirmed"
              }
            >
              {overwrites.map((overwrite) => (
                <div key={overwrite.id} className="flex flex-col gap-2 rounded-md border p-2.5">
                  <p>
                    {overwrite.title}: you and {overwrite.by} both edited it.
                  </p>
                  <BeforeAfter overwrite={overwrite} />
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={accepted.has(overwrite.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(accepted);
                        if (checked) next.add(overwrite.id);
                        else next.delete(overwrite.id);
                        setAccepted(next);
                      }}
                    />
                    Replace {overwrite.by}'s version with mine
                  </label>
                </div>
              ))}
            </Step>
          )}
          <Step
            state="done"
            title={
              scenario.merges.length
                ? `Up to date with Live (${scenario.merges.length} changes merged in)`
                : "Up to date with Live"
            }
          >
            {scenario.merges.length > 0 && (
              <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm">
                {scenario.merges.map((merge) => (
                  <li key={merge.id}>
                    {merge.by}: {merge.description.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
          </Step>
          <Step
            state={scenario.translations.status === "done" ? "done" : "running"}
            title={translationLine(scenario)}
          >
            {scenario.translations.status === "running" && (
              <p className="text-muted-foreground text-sm">
                Publishing waits for it, so every language goes live together.
              </p>
            )}
          </Step>
          <Step
            state="info"
            last
            title={
              <button
                type="button"
                className="flex items-center gap-1.5 hover:underline"
                onClick={() => setShowChanges(!showChanges)}
              >
                Look over {changeCount(scenario)} changes (optional)
                <ChevronRight
                  className={cn("size-3.5 transition-transform", showChanges && "rotate-90")}
                />
              </button>
            }
          >
            {showChanges && (
              <ul className="flex flex-col gap-1 text-sm">
                {scenario.places.map((place) => (
                  <li key={place.id}>
                    <span className="font-medium">{place.name}</span>{" "}
                    <span className="text-muted-foreground">· {place.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </Step>
        </ol>
      </div>
      <Footer
        publishDisabled={left > 0 || scenario.translations.status === "running"}
        publishLabel={left > 0 ? `Publish · ${left} step${left === 1 ? "" : "s"} left` : "Publish"}
      />
    </>
  );
}

// --- Round 2, after feedback on A and B ---
// Kept: A's "Before you publish" (no Show button), B's one-line summary, given more weight, and
// B's priorities (fix, then overwrites, then what's already fine), without a timeline.
// Changes become one table per page or category, colored like a diff, old values crossed out.
// E, F and G differ in where the summary sits and in how the tables read.

const ROW_TINT: Record<ProtoChange["kind"], string> = {
  created: "bg-green-500/[0.07]",
  deleted: "bg-destructive/[0.07]",
  changed: "",
  moved: "",
};

const GUTTER: Record<ProtoChange["kind"], string> = {
  created: "bg-green-500",
  deleted: "bg-destructive",
  changed: "bg-amber-400",
  moved: "bg-sky-400",
};

function BeforeYouPublish({
  scenario,
  heading = true,
}: {
  scenario: ProtoScenario;
  heading?: boolean;
}) {
  const blockers = scenario.issues.filter(
    (issue): issue is ProtoBlocker => issue.kind === "blocker",
  );
  const overwrites = scenario.issues.filter(
    (issue): issue is ProtoOverwrite => issue.kind === "overwrite",
  );
  if (scenario.issues.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {heading && <h3 className="text-sm font-medium">Before you publish</h3>}
      {blockers.map((blocker) => (
        <div
          key={blocker.id}
          className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3"
        >
          <OctagonX className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="font-medium">{blocker.title}</p>
            <p className="text-muted-foreground">{blocker.detail}</p>
          </div>
          <Button size="sm" onClick={stub("open the testimonial in the Canvas")}>
            {blocker.fix}
          </Button>
        </div>
      ))}
      {overwrites.map((overwrite) => (
        <div
          key={overwrite.id}
          className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
        >
          <div className="flex gap-2">
            <Replace className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">
                Replaces {overwrite.by}'s edit to the {overwrite.title.toLowerCase()}
              </p>
              <p className="text-muted-foreground">
                You both changed it on {overwrite.at}. Publishing keeps your version.
              </p>
            </div>
          </div>
          <div className="pl-6">
            <BeforeAfter overwrite={overwrite} />
          </div>
          <div className="pl-6">
            <Button
              size="sm"
              variant="outline"
              onClick={stub(`take ${overwrite.by}'s version into the draft`)}
            >
              Use {overwrite.by}'s version instead
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** What's already fine, one quiet line each. */
function AllSet({ scenario }: { scenario: ProtoScenario }) {
  const names = [...new Set(scenario.merges.map((merge) => merge.by))];
  const lines = [
    {
      key: "live",
      done: true,
      text: names.length
        ? `Includes the latest from Live, with ${names.join(" and ")}'s recent changes`
        : "Nothing changed on Live since this draft started",
    },
    {
      key: "translations",
      done: scenario.translations.status === "done",
      text:
        scenario.translations.status === "done"
          ? `Translated into ${scenario.translations.locales.join(" and ")}`
          : `Translating into ${scenario.translations.locales.join(" and ")}. Publishing waits for it.`,
    },
  ];
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map((line) => (
        <li key={line.key} className="text-muted-foreground flex items-start gap-2">
          {line.done ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <Spinner className="mt-0.5 size-4 shrink-0" />
          )}
          {line.text}
        </li>
      ))}
    </ul>
  );
}

function PlaceHeading({ place, count }: { place: ProtoPlace; count?: boolean }) {
  const Icon = PLACE_ICONS[place.kind];
  return (
    <h3 className="flex items-center gap-2">
      <Icon className="text-muted-foreground size-4" />
      <span className="font-medium">{place.name}</span>
      {place.path && <span className="text-muted-foreground text-xs">{place.path}</span>}
      {place.isNew && (
        <span className="rounded bg-green-500/15 px-1.5 text-xs text-green-700 dark:text-green-400">
          New page
        </span>
      )}
      {count && (
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {place.changes.length}
        </span>
      )}
    </h3>
  );
}

/** A value as it changes: the old one crossed out, then the new one. */
function Value({ diff }: { diff: FieldDiff }) {
  if (diff.missing) {
    return (
      <span className="text-destructive inline-flex items-center gap-1.5 font-medium">
        <OctagonX className="size-3.5" />
        Missing
        <button
          type="button"
          className="font-normal underline"
          onClick={stub("open the testimonial in the Canvas")}
        >
          Add
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      {diff.before !== undefined && (
        <del className="text-muted-foreground decoration-destructive/60">{diff.before}</del>
      )}
      {diff.after !== undefined && <span>{diff.after}</span>}
      {diff.overwrites && (
        <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-amber-500/15 px-1.5 text-xs text-amber-700 dark:text-amber-400">
          <Replace className="size-3" />
          Replaces {diff.overwrites}'s
        </span>
      )}
    </span>
  );
}

const rowsOf = (change: ProtoChange): FieldDiff[] =>
  change.diffs.length ? change.diffs : [{ field: "", after: change.label }];

// E: a table per place, one row per field. The block name spans its rows; a colored edge and
// tint give the kind of change, like a diff gutter.

function RowsTable({ place }: { place: ProtoPlace }) {
  const isFiles = place.kind === "files";
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border text-sm">
      <colgroup>
        <col className="w-1" />
        {!isFiles && <col className="w-28" />}
        {!isFiles && <col className="w-24" />}
        <col />
      </colgroup>
      <tbody>
        {place.changes.flatMap((change, changeIndex) =>
          rowsOf(change).map((diff, index) => (
            <tr key={`${change.id}:${diff.field}`} className={ROW_TINT[change.kind]}>
              <td className={cn("p-0", GUTTER[change.kind])} />
              {!isFiles && index === 0 && (
                <td
                  rowSpan={rowsOf(change).length}
                  className={cn(
                    "px-2.5 py-1.5 align-top font-medium",
                    changeIndex > 0 && "border-t",
                    change.kind === "deleted" && "line-through decoration-destructive/60",
                  )}
                >
                  {change.label}
                </td>
              )}
              {!isFiles && (
                <td
                  className={cn(
                    "text-muted-foreground px-2.5 py-1.5 align-top",
                    (changeIndex > 0 || index > 0) && "border-t",
                  )}
                >
                  {diff.field}
                </td>
              )}
              <td
                className={cn(
                  "px-2.5 py-1.5 align-top",
                  (changeIndex > 0 || index > 0) && "border-t",
                )}
              >
                <Value diff={diff} />
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

function VariantE({ scenario }: { scenario: ProtoScenario }) {
  const blockers = scenario.issues.filter((issue) => issue.kind === "blocker").length;
  return (
    <>
      <Header scenario={scenario} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <p className="text-xl leading-snug font-semibold tracking-tight">
          {scenario.summary.headline}
        </p>
        <BeforeYouPublish scenario={scenario} />
        <AllSet scenario={scenario} />
        <div className="flex flex-col gap-5">
          <h3 className="text-muted-foreground border-t pt-5 text-xs font-medium">
            {changeCount(scenario)} changes
          </h3>
          {scenario.places.map((place) => (
            <section key={place.id} className="flex flex-col gap-2">
              <PlaceHeading place={place} />
              <RowsTable place={place} />
            </section>
          ))}
        </div>
      </div>
      <Footer publishDisabled={blockers > 0} />
    </>
  );
}

// F: the summary is the sheet's title. Tables read like a code diff: a header row per block,
// then a − line and a + line per field, each place collapsible.

const SIGN: Record<"add" | "remove" | "note", { sign: string; row: string; sign_: string }> = {
  add: {
    sign: "+",
    row: "bg-green-500/[0.08]",
    sign_: "text-green-700 dark:text-green-400",
  },
  remove: {
    sign: "−",
    row: "bg-destructive/[0.07]",
    sign_: "text-destructive",
  },
  note: { sign: "", row: "", sign_: "" },
};

function DiffLines({ place }: { place: ProtoPlace }) {
  const lines = (diff: FieldDiff) => {
    const out: { kind: keyof typeof SIGN; text: React.ReactNode }[] = [];
    if (diff.before !== undefined) {
      out.push({
        kind: "remove",
        text: <del className="decoration-destructive/50">{diff.before}</del>,
      });
    }
    if (diff.missing) out.push({ kind: "remove", text: <Value diff={diff} /> });
    if (diff.after !== undefined) {
      out.push({
        kind: "add",
        text: (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {diff.after}
            {diff.overwrites && (
              <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-700 dark:text-amber-400">
                replaces {diff.overwrites}'s
              </span>
            )}
          </span>
        ),
      });
    }
    return out;
  };
  return (
    <table className="w-full table-fixed overflow-hidden rounded-lg border text-sm">
      <colgroup>
        <col className="w-6" />
        <col className="w-24" />
        <col />
      </colgroup>
      <tbody>
        {place.changes.map((change) => (
          <React.Fragment key={change.id}>
            <tr className="bg-muted/50 border-t first:border-t-0">
              <td colSpan={3} className="px-2.5 py-1 text-xs font-medium">
                {change.label}
                {change.kind === "deleted" && <span className="text-destructive"> · removed</span>}
                {change.kind === "moved" && <span className="text-muted-foreground"> · moved</span>}
              </td>
            </tr>
            {change.diffs.flatMap((diff) =>
              lines(diff).map((line, index) => (
                <tr key={`${diff.field}:${index}`} className={SIGN[line.kind].row}>
                  <td
                    className={cn(
                      "px-2 py-1 text-center font-mono select-none",
                      SIGN[line.kind].sign_,
                    )}
                  >
                    {SIGN[line.kind].sign}
                  </td>
                  <td className="text-muted-foreground px-1 py-1 align-top">
                    {index === 0 ? diff.field : ""}
                  </td>
                  <td className="px-1 py-1 pr-2.5">{line.text}</td>
                </tr>
              )),
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function FilesList({ place }: { place: ProtoPlace }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {place.changes.map((change) => (
        <li
          key={change.id}
          className="rounded-md bg-green-500/10 px-2 py-1 text-sm text-green-800 dark:text-green-300"
        >
          + {change.label}
        </li>
      ))}
    </ul>
  );
}

function VariantF({ scenario }: { scenario: ProtoScenario }) {
  const blockers = scenario.issues.filter((issue) => issue.kind === "blocker").length;
  const [more, setMore] = React.useState(false);
  const [openPlaces, setOpenPlaces] = React.useState<Set<string>>(
    new Set(scenario.places.slice(0, 2).map((place) => place.id)),
  );
  return (
    <>
      <div className="flex flex-col gap-1.5 border-b p-4 pr-12">
        <SheetDescription>
          {scenario.draft.name} · {scenario.draft.startedBy}
          {scenario.draft.viaAgent && " with Camox"}, {scenario.draft.startedAgo}
        </SheetDescription>
        <SheetTitle className="text-lg leading-snug font-semibold">
          {scenario.summary.headline}
        </SheetTitle>
        {more && (
          <ul className="text-foreground/80 flex list-disc flex-col gap-0.5 pl-5">
            {scenario.summary.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground w-fit text-xs"
          onClick={() => setMore(!more)}
        >
          {more ? "Less" : "In more detail"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <BeforeYouPublish scenario={scenario} />
        <AllSet scenario={scenario} />
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Changes</h3>
          {scenario.places.map((place) => {
            const open = openPlaces.has(place.id);
            return (
              <section key={place.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="hover:bg-muted/50 -mx-2 flex items-center gap-1 rounded-md px-2 py-1.5 text-left"
                  onClick={() => {
                    const next = new Set(openPlaces);
                    if (open) next.delete(place.id);
                    else next.add(place.id);
                    setOpenPlaces(next);
                  }}
                >
                  <ChevronRight
                    className={cn(
                      "text-muted-foreground size-4 shrink-0 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="flex-1">
                    <PlaceHeading place={place} count />
                  </span>
                </button>
                {open &&
                  (place.kind === "files" ? (
                    <FilesList place={place} />
                  ) : (
                    <DiffLines place={place} />
                  ))}
              </section>
            );
          })}
        </div>
      </div>
      <Footer publishDisabled={blockers > 0} />
    </>
  );
}

// G: a wider sheet, the summary in a card, and Before | After columns per place.

function BeforeAfterTable({ place }: { place: ProtoPlace }) {
  return (
    <table className="w-full table-fixed overflow-hidden rounded-lg border text-sm">
      <colgroup>
        <col className="w-28" />
        <col />
        <col />
      </colgroup>
      <thead className="bg-muted/50 text-muted-foreground text-xs">
        <tr>
          <th className="px-2.5 py-1.5 text-left font-medium" />
          <th className="px-2.5 py-1.5 text-left font-medium">Before</th>
          <th className="px-2.5 py-1.5 text-left font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {place.changes.map((change) => (
          <React.Fragment key={change.id}>
            <tr className="border-t">
              <td colSpan={3} className="px-2.5 pt-2.5 pb-0.5 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", GUTTER[change.kind])} />
                  {change.label}
                </span>
              </td>
            </tr>
            {rowsOf(change).map((diff) => (
              <tr key={diff.field}>
                <td className="text-muted-foreground px-2.5 py-1 align-top">{diff.field}</td>
                <td className="px-2.5 py-1 align-top">
                  {diff.before !== undefined ? (
                    <del className="text-muted-foreground bg-destructive/[0.07] decoration-destructive/60 rounded px-1">
                      {diff.before}
                    </del>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2.5 py-1 align-top">
                  {diff.missing ? (
                    <Value diff={diff} />
                  ) : diff.after !== undefined ? (
                    <span className="flex flex-col gap-0.5">
                      <span className="w-fit rounded bg-green-500/10 px-1">{diff.after}</span>
                      {diff.overwrites && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          Replaces {diff.overwrites}'s
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-destructive text-xs">Removed</span>
                  )}
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function VariantG({ scenario }: { scenario: ProtoScenario }) {
  const blockers = scenario.issues.filter((issue) => issue.kind === "blocker").length;
  const [more, setMore] = React.useState(false);
  return (
    <>
      <Header scenario={scenario} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <section className="bg-muted/50 flex flex-col gap-2 rounded-xl p-4">
          <p className="text-lg leading-snug font-medium">{scenario.summary.headline}</p>
          {more && (
            <ul className="text-foreground/80 flex list-disc flex-col gap-0.5 pl-5">
              {scenario.summary.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-fit text-xs"
            onClick={() => setMore(!more)}
          >
            {more ? "Less" : "In more detail"}
          </button>
        </section>
        <BeforeYouPublish scenario={scenario} />
        <AllSet scenario={scenario} />
        <div className="flex flex-col gap-5">
          {scenario.places.map((place) => (
            <section key={place.id} className="flex flex-col gap-2">
              <PlaceHeading place={place} />
              {place.kind === "files" ? (
                <FilesList place={place} />
              ) : (
                <BeforeAfterTable place={place} />
              )}
            </section>
          ))}
        </div>
      </div>
      <Footer publishDisabled={blockers > 0} />
    </>
  );
}

// --- Round 3: no change table. The summary is the sheet's title; the full AI description sits
// in the body, uncollapsed and outside any card, above the problem cards (no heading). ---

function Round3({
  scenario,
  description,
}: {
  scenario: ProtoScenario;
  description: React.ReactNode;
}) {
  const blockers = scenario.issues.filter((issue) => issue.kind === "blocker").length;
  return (
    <>
      <div className="flex flex-col gap-1 border-b p-4 pr-12">
        <SheetDescription>
          {scenario.draft.name} · {scenario.draft.startedBy}
          {scenario.draft.viaAgent && " with Camox"}, {scenario.draft.startedAgo}
        </SheetDescription>
        <SheetTitle className="text-lg leading-snug font-semibold">
          {scenario.summary.headline}
        </SheetTitle>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {description}
        <BeforeYouPublish scenario={scenario} heading={false} />
        <AllSet scenario={scenario} />
      </div>
      <Footer publishDisabled={blockers > 0} />
    </>
  );
}

function VariantH({ scenario }: { scenario: ProtoScenario }) {
  return (
    <Round3
      scenario={scenario}
      description={
        <ul className="text-foreground/85 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
          {scenario.summary.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      }
    />
  );
}

function VariantI({ scenario }: { scenario: ProtoScenario }) {
  return (
    <Round3
      scenario={scenario}
      description={<p className="text-foreground/85 leading-relaxed">{scenario.summary.brief}</p>}
    />
  );
}

// --- Host ---

const VARIANTS = [
  { key: "H", name: "Round 3, bullets", Component: VariantH, wide: false },
  { key: "I", name: "Round 3, paragraph", Component: VariantI, wide: false },
  { key: "A", name: "Round 1, brief", Component: VariantA, wide: false },
  { key: "B", name: "Round 1, checklist", Component: VariantB, wide: false },
  { key: "E", name: "Round 2, row tables", Component: VariantE, wide: false },
  { key: "F", name: "Round 2, diff lines", Component: VariantF, wide: false },
  { key: "G", name: "Round 2, before | after", Component: VariantG, wide: true },
];

/** The review sheet prototype, open whenever `?variant=` is set. Read-only, fake data. */
export function ReviewDraftSheetPrototype() {
  const variant = usePrototypeVariant();
  const [open, setOpen] = React.useState(true);
  const [scenarioKey, setScenarioKey] = React.useState<ScenarioKey>("problems");
  if (!variant) return null;
  const current = VARIANTS.find((entry) => entry.key === variant) ?? VARIANTS[0]!;
  const scenario = SCENARIOS[scenarioKey];

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
        <SheetContent
          side="right"
          className={cn(
            "w-full gap-0",
            current.wide ? "data-[side=right]:sm:max-w-2xl" : "data-[side=right]:sm:max-w-lg",
          )}
        >
          {/* Keyed so each variant and scenario starts fresh. */}
          <current.Component key={`${current.key}:${scenarioKey}`} scenario={scenario} />
        </SheetContent>
      </Sheet>
      <PrototypeSwitcher
        variants={VARIANTS}
        current={current.key}
        extra={
          <>
            <span className="mx-1 h-5 w-px bg-white/20" />
            <button
              type="button"
              className="rounded-full px-2.5 py-1 hover:bg-white/15"
              onClick={() => setScenarioKey(scenarioKey === "problems" ? "clean" : "problems")}
            >
              Data: {scenarioKey === "problems" ? "with problems" : "clean, translating"}
            </button>
            {!open && (
              <button
                type="button"
                className="rounded-full bg-white px-2.5 py-1 text-black"
                onClick={() => setOpen(true)}
              >
                Open sheet
              </button>
            )}
          </>
        }
      />
    </>
  );
}
