/**
 * PROTOTYPE (#203), throwaway. In-memory drafts for the studio UI prototype:
 * nothing here talks to the API, and a reload resets everything.
 */
import { createStore } from "@xstate/store-react";

export type Creator = { name: string; kind: "member" | "agent" };

export type Change = {
  id: string;
  kind: "added" | "changed" | "deleted";
  entity: "page" | "block" | "layout" | "synced block" | "record" | "file";
  label: string;
  /** The page a change shows on, used for grouping. */
  page: string;
  /** A reference whose target Live deleted: publishes, reads as empty. */
  dangling?: string;
};

export type Conflict = { id: string; label: string; publishedBy: string; publishedAt: number };
export type Lost = { id: string; label: string; reason: string };
export type DuplicatePath = { path: string; pages: string[] };

export type Draft = {
  id: string;
  name: string | null;
  creator: Creator;
  createdAt: number;
  development?: boolean;
  changes: Change[];
  conflicts: Conflict[];
  lost: Lost[];
  duplicatePaths: DuplicatePath[];
  /** Development drafts only: definitions whose schema differs from Live's. */
  definitionMismatches: string[];
};

const now = Date.now();
const hours = (n: number) => now - n * 3_600_000;
const days = (n: number) => now - n * 86_400_000;

export const ME: Creator = { name: "Rémi", kind: "member" };

function initialDrafts(): Draft[] {
  return [
    {
      id: "spring",
      name: "Spring campaign",
      creator: { name: "Alice", kind: "member" },
      createdAt: days(4),
      changes: [
        { id: "c1", kind: "added", entity: "page", label: "Spring sale", page: "/spring-sale" },
        { id: "c2", kind: "added", entity: "block", label: "Hero", page: "/spring-sale" },
        { id: "c3", kind: "added", entity: "block", label: "Product grid", page: "/spring-sale" },
        {
          id: "c4",
          kind: "changed",
          entity: "block",
          label: "Featured products",
          page: "/spring-sale",
          dangling: "references “Winter jacket”, which Live deleted",
        },
        { id: "c5", kind: "changed", entity: "block", label: "Hero", page: "/" },
        { id: "c6", kind: "changed", entity: "synced block", label: "Announcement bar", page: "/" },
        { id: "c7", kind: "changed", entity: "layout", label: "Main layout · footer", page: "/" },
        { id: "c8", kind: "added", entity: "record", label: "Testimonial · Jane D.", page: "/" },
        { id: "c9", kind: "added", entity: "file", label: "spring-hero.jpg", page: "/spring-sale" },
        { id: "c10", kind: "deleted", entity: "block", label: "Newsletter signup", page: "/" },
      ],
      conflicts: [
        { id: "k1", label: "Hero on /", publishedBy: "Bob", publishedAt: hours(3) },
        {
          id: "k2",
          label: "Announcement bar (synced block)",
          publishedBy: "Pricing agent",
          publishedAt: days(1),
        },
      ],
      lost: [
        {
          id: "l1",
          label: "Testimonials block on /about",
          reason: "/about was deleted in Live after this draft changed it",
        },
      ],
      duplicatePaths: [],
      definitionMismatches: [],
    },
    {
      id: "pricing",
      name: "Pricing page rewrite",
      creator: { name: "Pricing agent", kind: "agent" },
      createdAt: hours(20),
      changes: [
        { id: "p1", kind: "added", entity: "page", label: "Pricing", page: "/pricing" },
        { id: "p2", kind: "added", entity: "block", label: "Pricing table", page: "/pricing" },
        { id: "p3", kind: "added", entity: "block", label: "FAQ", page: "/pricing" },
      ],
      conflicts: [],
      lost: [],
      duplicatePaths: [{ path: "/pricing", pages: ["Pricing (this draft)", "Plans (Live)"] }],
      definitionMismatches: [],
    },
    {
      id: "typo",
      name: null,
      creator: ME,
      createdAt: days(2),
      changes: [
        { id: "t1", kind: "changed", entity: "block", label: "About intro", page: "/about" },
        {
          id: "t2",
          kind: "changed",
          entity: "record",
          label: "Team member · Alice",
          page: "/about",
        },
      ],
      conflicts: [],
      lost: [],
      duplicatePaths: [],
      definitionMismatches: [],
    },
  ];
}

function developmentDraft(): Draft {
  return {
    id: "dev",
    name: null,
    creator: ME,
    createdAt: days(30),
    development: true,
    changes: [
      { id: "d1", kind: "changed", entity: "block", label: "Hero (new “badge” field)", page: "/" },
    ],
    conflicts: [],
    lost: [],
    duplicatePaths: [],
    definitionMismatches: ["Hero"],
  };
}

type Context = {
  /** "live" or a draft id. */
  current: string;
  drafts: Draft[];
  studio: "production" | "development";
  live: { publishedBy: string; publishedAt: number };
  /** Bumped by `edit` while viewing Live, so a variant can react to a new draft. */
  startedDraftId: string | null;
};

const initialContext = (studio: Context["studio"] = "production"): Context => ({
  current: "live",
  drafts: studio === "development" ? [developmentDraft(), ...initialDrafts()] : initialDrafts(),
  studio,
  live: { publishedBy: "Bob", publishedAt: hours(3) },
  startedDraftId: null,
});

let editCount = 0;
const SAMPLE_EDITS = ["Hero · heading", "Features · item 2", "Footer · links", "CTA · button"];

export const draftsStore = createStore({
  context: initialContext(),
  on: {
    select: (context, event: { id: string }) => ({ ...context, current: event.id }),
    /** A content write. On Live it creates a new unnamed draft with that write. */
    edit: (context) => {
      editCount += 1;
      const change: Change = {
        id: `e${editCount}`,
        kind: "changed",
        entity: "block",
        label: SAMPLE_EDITS[editCount % SAMPLE_EDITS.length]!,
        page: "/",
      };
      if (context.current === "live") {
        const draft: Draft = {
          id: `new${editCount}`,
          name: null,
          creator: ME,
          createdAt: Date.now(),
          changes: [change],
          conflicts: [],
          lost: [],
          duplicatePaths: [],
          definitionMismatches: [],
        };
        return {
          ...context,
          drafts: [draft, ...context.drafts],
          current: draft.id,
          startedDraftId: draft.id,
        };
      }
      return {
        ...context,
        drafts: context.drafts.map((draft) =>
          draft.id === context.current ? { ...draft, changes: [...draft.changes, change] } : draft,
        ),
      };
    },
    /** Someone else publishes over what the current draft changed. */
    livePublishedElsewhere: (context) => {
      if (context.current === "live") return context;
      const at = Date.now();
      return {
        ...context,
        live: { publishedBy: "Carol", publishedAt: at },
        drafts: context.drafts.map((draft) =>
          draft.id === context.current
            ? {
                ...draft,
                conflicts: [
                  ...draft.conflicts,
                  {
                    id: `k${at}`,
                    label: `${draft.changes.at(-1)?.label ?? "Hero"} on /`,
                    publishedBy: "Carol",
                    publishedAt: at,
                  },
                ],
              }
            : draft,
        ),
      };
    },
    rename: (context, event: { id: string; name: string }) => ({
      ...context,
      drafts: context.drafts.map((draft) =>
        draft.id === event.id ? { ...draft, name: event.name.trim() || null } : draft,
      ),
    }),
    fixDuplicatePath: (context, event: { id: string }) => ({
      ...context,
      drafts: context.drafts.map((draft) =>
        draft.id === event.id ? { ...draft, duplicatePaths: [] } : draft,
      ),
    }),
    /** Publishing or discarding ends a draft; a development draft is only emptied. */
    end: (context, event: { id: string; published: boolean }) => {
      const draft = context.drafts.find((d) => d.id === event.id);
      const live = event.published
        ? { publishedBy: ME.name, publishedAt: Date.now() }
        : context.live;
      const drafts = draft?.development
        ? context.drafts.map((d) =>
            d.id === event.id ? { ...d, changes: [], conflicts: [], lost: [] } : d,
          )
        : context.drafts.filter((d) => d.id !== event.id);
      return {
        ...context,
        live,
        drafts,
        current: draft?.development ? draft.id : "live",
        startedDraftId: null,
      };
    },
    acknowledgeStarted: (context) => ({ ...context, startedDraftId: null }),
    toggleStudio: (context) =>
      initialContext(context.studio === "production" ? "development" : "production"),
    reset: (context) => initialContext(context.studio),
  },
});

export type DraftsContext = Context;

export function draftLabel(draft: Draft) {
  if (draft.development) return "Development draft";
  if (draft.name) return draft.name;
  return `${draft.creator.name} · ${formatDate(draft.createdAt)}`;
}

export function formatDate(at: number) {
  return new Date(at).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function timeAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** What blocks publishing. Only duplicate paths and unreleased definitions do. */
export function getBlockers(draft: Draft) {
  return [
    ...draft.duplicatePaths.map(
      (dup) => `${dup.path} is used by ${dup.pages.join(" and ")}. Change one of the paths.`,
    ),
    ...(draft.definitionMismatches.length > 0
      ? [
          `${draft.definitionMismatches.join(", ")} differs from Live. Release your code, then publish.`,
        ]
      : []),
  ];
}

export function groupByPage(changes: Change[]) {
  const groups = new Map<string, Change[]>();
  for (const change of changes) {
    groups.set(change.page, [...(groups.get(change.page) ?? []), change]);
  }
  return [...groups.entries()];
}
