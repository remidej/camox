// PROTOTYPE — throwaway fake data for the review sheet variants.
// It assumes capabilities the backend doesn't have yet: an AI summary of the draft, field-level
// diffs, and Live changes merged into the draft as they happen (only real overlaps conflict).

export type FieldDiff = {
  field: string;
  before?: string;
  after?: string;
  /** A required value left empty: the blocker sits on this row. */
  missing?: boolean;
  /** Ana also changed this field on Live: the draft's value replaces hers. */
  overwrites?: string;
};

export type ProtoChange = {
  id: string;
  kind: "created" | "changed" | "deleted" | "moved";
  label: string;
  diffs: FieldDiff[];
};

export type PlaceKind = "page" | "layout" | "collection" | "files" | "languages";

export type ProtoPlace = {
  id: string;
  kind: PlaceKind;
  name: string;
  path?: string;
  isNew?: boolean;
  /** AI one-liner: what the draft does here. */
  summary: string;
  changes: ProtoChange[];
};

export type ProtoBlocker = {
  kind: "blocker";
  id: string;
  placeId: string;
  changeId: string;
  title: string;
  detail: string;
  fix: string;
};

/** Both the draft and Live edited the same field: the draft's version replaces Live's. */
export type ProtoOverwrite = {
  kind: "overwrite";
  id: string;
  placeId: string;
  changeId: string;
  title: string;
  field: string;
  live: string;
  draft: string;
  by: string;
  at: string;
};

export type ProtoIssue = ProtoBlocker | ProtoOverwrite;

/** A Live change Camox merged into the draft on its own. */
export type ProtoMerge = {
  id: string;
  placeId: string;
  by: string;
  at: string;
  description: string;
  field: string;
  before: string;
  after: string;
};

export type ProtoScenario = {
  draft: {
    name: string;
    startedBy: string;
    startedAgo: string;
    viaAgent: boolean;
    contributors: string[];
  };
  summary: { headline: string; paragraphs: string[]; bullets: string[]; brief: string };
  places: ProtoPlace[];
  issues: ProtoIssue[];
  merges: ProtoMerge[];
  translations: { locales: string[]; status: "done" | "running"; fields: number };
};

const places: ProtoPlace[] = [
  {
    id: "black-friday",
    kind: "page",
    name: "Black Friday",
    path: "/black-friday",
    isNew: true,
    summary: "A new landing page for the 30% offer, with a countdown, pricing and FAQ.",
    changes: [
      {
        id: "bf-hero",
        kind: "created",
        label: "Hero",
        diffs: [
          { field: "Title", after: "30% off every plan, until Dec 1st" },
          { field: "Subtitle", after: "Every feature, every plan. Ends Dec 1st at midnight." },
          { field: "Button", after: "Claim the offer" },
          { field: "Image", after: "black-friday-hero.jpg" },
        ],
      },
      {
        id: "bf-countdown",
        kind: "created",
        label: "Countdown",
        diffs: [{ field: "Ends", after: "Dec 1, 23:59" }],
      },
      {
        id: "bf-pricing",
        kind: "created",
        label: "Pricing table",
        diffs: [{ field: "Plans", after: "Pro, Team" }],
      },
      {
        id: "bf-testimonial",
        kind: "created",
        label: "Testimonial",
        diffs: [
          { field: "Quote", after: "We rebuilt our whole site in a weekend." },
          { field: "Author", after: "Marie, Lumen Studio" },
          { field: "Photo", missing: true },
        ],
      },
      {
        id: "bf-faq",
        kind: "created",
        label: "FAQ",
        diffs: [{ field: "Questions", after: "4 questions" }],
      },
    ],
  },
  {
    id: "home",
    kind: "page",
    name: "Home",
    path: "/",
    summary: "The hero now leads with the offer, and a banner points to the new page.",
    changes: [
      {
        id: "home-hero",
        kind: "changed",
        label: "Hero",
        diffs: [
          {
            field: "Title",
            before: "Build websites your team can keep up with",
            after: "Black Friday: 30% off every plan",
            overwrites: "Ana",
          },
          { field: "Button", before: "Start for free", after: "See the offer" },
        ],
      },
      {
        id: "home-banner",
        kind: "created",
        label: "Announcement bar",
        diffs: [{ field: "Text", after: "Black Friday ends Dec 1st →" }],
      },
      {
        id: "home-spring",
        kind: "deleted",
        label: "Spring sale banner",
        diffs: [{ field: "Text", before: "Spring sale: 2 months free on annual plans" }],
      },
      {
        id: "home-logos",
        kind: "moved",
        label: "Customer logos",
        diffs: [{ field: "Position", before: "2nd", after: "4th" }],
      },
    ],
  },
  {
    id: "main-layout",
    kind: "layout",
    name: "Main layout",
    summary: "Adds a “Deals” link to the navigation.",
    changes: [
      {
        id: "nav",
        kind: "changed",
        label: "Navigation",
        diffs: [
          {
            field: "Links",
            before: "Product, Pricing, Blog",
            after: "Product, Pricing, Deals, Blog",
          },
        ],
      },
    ],
  },
  {
    id: "plans",
    kind: "collection",
    name: "Pricing plans",
    summary: "Discounted prices on Pro and Team.",
    changes: [
      {
        id: "plan-pro",
        kind: "changed",
        label: "Pro",
        diffs: [{ field: "Monthly price", before: "$29", after: "$20" }],
      },
      {
        id: "plan-team",
        kind: "changed",
        label: "Team",
        diffs: [
          { field: "Monthly price", before: "$79", after: "$55" },
          { field: "Badge", after: "Black Friday" },
        ],
      },
    ],
  },
  {
    id: "files",
    kind: "files",
    name: "Files",
    summary: "Two campaign images.",
    changes: [
      { id: "file-hero", kind: "created", label: "black-friday-hero.jpg", diffs: [] },
      { id: "file-og", kind: "created", label: "og-black-friday.png", diffs: [] },
    ],
  },
];

const problems: ProtoScenario = {
  draft: {
    name: "Black Friday campaign",
    startedBy: "Rémi",
    startedAgo: "3 days ago",
    viaAgent: true,
    contributors: ["Rémi", "Camox", "Léa"],
  },
  summary: {
    headline: "Launches the Black Friday offer: 30% off Pro and Team until Dec 1st.",
    paragraphs: [
      "Adds a new Black Friday page with a countdown, the discounted plans, a testimonial and an FAQ. The homepage hero now leads with the offer, and an announcement bar and a new “Deals” link in the navigation point to the page.",
      "Pro drops from $29 to $20 and Team from $79 to $55. Everything is translated into French and German.",
    ],
    bullets: [
      "New page /black-friday: a countdown to Dec 1st, the discounted plans, a customer testimonial and an FAQ",
      "Homepage: the hero now leads with the offer, an announcement bar links to the new page, the Spring sale banner is removed and the customer logos move lower",
      "Navigation: a new “Deals” link between Pricing and Blog",
      "Pricing: Pro goes from $29 to $20, Team from $79 to $55 with a “Black Friday” badge",
      "Two new images: the campaign hero and its social preview",
    ],
    brief:
      "Adds a /black-friday page with a countdown, the discounted plans, a testimonial and an FAQ. On the homepage, the hero now leads with the offer, a new announcement bar links to the page, and the Spring sale banner is removed. The navigation gets a “Deals” link, and Pro drops to $20 and Team to $55 until Dec 1st.",
  },
  places,
  issues: [
    {
      kind: "blocker",
      id: "issue-photo",
      placeId: "black-friday",
      changeId: "bf-testimonial",
      title: "The testimonial has no photo",
      detail: "Its photo is required, so the page can't go live without one.",
      fix: "Add a photo",
    },
    {
      kind: "overwrite",
      id: "issue-title",
      placeId: "home",
      changeId: "home-hero",
      title: "Homepage hero title",
      field: "Title",
      live: "Build websites your whole team can keep up with",
      draft: "Black Friday: 30% off every plan",
      by: "Ana",
      at: "Oct 21",
    },
  ],
  merges: [
    {
      id: "merge-subtitle",
      placeId: "home",
      by: "Ana",
      at: "Oct 21",
      description: "Fixed a typo in the homepage hero subtitle",
      field: "Subtitle",
      before: "Pages your marketing team can edit in minuts.",
      after: "Pages your marketing team can edit in minutes.",
    },
    {
      id: "merge-faq",
      placeId: "plans",
      by: "Léa",
      at: "Oct 22",
      description: "Added a refund question to the pricing FAQ",
      field: "Questions",
      before: "5 questions",
      after: "6 questions",
    },
  ],
  translations: { locales: ["French", "German"], status: "done", fields: 38 },
};

const clean: ProtoScenario = {
  ...problems,
  issues: [],
  merges: [],
  translations: { locales: ["French", "German"], status: "running", fields: 38 },
};

export const SCENARIOS = { problems, clean } as const;
export type ScenarioKey = keyof typeof SCENARIOS;

export const changeCount = (scenario: ProtoScenario) =>
  scenario.places.reduce((count, place) => count + place.changes.length, 0);

export const issuesIn = (scenario: ProtoScenario, placeId: string) =>
  scenario.issues.filter((issue) => issue.placeId === placeId);

export const mergesIn = (scenario: ProtoScenario, placeId: string) =>
  scenario.merges.filter((merge) => merge.placeId === placeId);
