import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  DismissalView,
  FindingView,
  PatrollerId,
  PatrollerView,
  PatrolView,
  ReportView,
} from "@camox/api-contract/patrol";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { Popover } = await import("@camox/ui/popover");
const { PatrolRoster, PatrollerCard } = await import("./Patrol");

const now = Date.UTC(2026, 9, 27, 12);
const minutes = (count: number) => now - count * 60_000;

const pricing = { entity: "page" as const, id: "page-1", name: "Pricing" };
const team = { entity: "file" as const, id: "file-1", name: "team.png" };

const report = (
  id: string,
  overrides: Partial<ReportView> & Pick<ReportView, "summary">,
): ReportView => ({
  id,
  outcome: "done",
  at: minutes(2),
  live: false,
  place: null,
  ...overrides,
});

const seoManager = (overrides: Partial<PatrollerView> = {}): PatrollerView => ({
  id: "seoManager",
  role: "SEO manager",
  duty: "asYouGo",
  working: null,
  lastCheckedAt: null,
  lastActivityAt: minutes(2),
  reports: [
    report("1", {
      summary: { kind: "structured", verb: "wroteSeo", subject: pricing, locale: "de" },
    }),
    report("2", {
      at: minutes(5),
      outcome: "failed",
      summary: { kind: "structured", verb: "wroteSeo", subject: pricing, locale: "fr" },
    }),
    report("3", {
      at: minutes(90),
      live: true,
      summary: { kind: "structured", verb: "describedFile", subject: team, locale: "en" },
    }),
  ],
  more: [],
  findings: [],
  dismissals: [],
  ...overrides,
});

const translator: PatrollerView = {
  id: "translator",
  role: "Translator",
  duty: "asYouGo",
  working: null,
  lastCheckedAt: null,
  lastActivityAt: null,
  reports: [],
  more: [],
  findings: [],
  dismissals: [],
};

const footer = { entity: "block" as const, id: "block-1", name: "Footer" };

const finding = (id: number, overrides: Partial<FindingView> = {}): FindingView => ({
  id,
  about: { kind: "missingPage", url: "camox:page:page-2", text: "About us", page: "About" },
  fix: { kind: "removeLink" },
  subject: footer,
  locale: "en",
  field: "body",
  fieldKind: "String",
  raisedAt: minutes(3),
  live: false,
  place: { kind: "page", pageId: "page-1", blockId: "block-1", itemId: null },
  ...overrides,
});

const dismissal = (id: number, overrides: Partial<DismissalView> = {}): DismissalView => ({
  id,
  about: { kind: "missingPage", url: "camox:page:page-3", text: "Team", page: "Team" },
  by: { id: "user-1", name: "Ada" },
  at: minutes(60),
  ...overrides,
});

const linkChecker = (overrides: Partial<PatrollerView> = {}): PatrollerView => ({
  id: "linkChecker",
  role: "Link checker",
  duty: "atPublish",
  working: null,
  lastCheckedAt: minutes(1),
  lastActivityAt: minutes(1),
  reports: [
    report("r1", {
      at: minutes(10),
      summary: { kind: "structured", verb: "removedLink", subject: footer, locale: "en" },
    }),
  ],
  more: [],
  findings: [],
  dismissals: [],
  ...overrides,
});

/** Renders the Patrol into a document, to read it as editors do. */
function render(
  view: PatrolView,
  options: { open?: PatrollerId; inDraft?: boolean; singleLocale?: boolean } = {},
) {
  const { document } = new Window();
  const inDraft = options.inDraft ?? true;
  // The open patroller's reports show in a popover, apart from the roster.
  const opened = view.patrollers.find(({ id }) => id === options.open);
  document.body.innerHTML = renderToString(
    <>
      <PatrolRoster
        view={view}
        now={now}
        inDraft={inDraft}
        singleLocale={options.singleLocale ?? false}
        open={options.open ?? null}
        onOpenChange={() => {}}
        onShow={() => {}}
        onApply={() => {}}
        onAsk={() => {}}
        onDismiss={() => {}}
        onOpenPatrolDraft={() => {}}
      />
      {opened && (
        <Popover open>
          <PatrollerCard
            patroller={opened}
            now={now}
            inDraft={inDraft}
            singleLocale={options.singleLocale ?? false}
            patrolDraft={view.patrolDraft}
            onShow={() => {}}
            onApply={() => {}}
            onAsk={() => {}}
            onDismiss={() => {}}
            onOpenPatrolDraft={() => {}}
          />
        </Popover>
      )}
    </>,
  );
  const patrollers = [...document.querySelectorAll("[data-patroller]")];
  const text = (element: { textContent: string | null } | null | undefined) =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    roles: patrollers.map((patroller) => text(patroller.querySelector("[data-patroller-role]"))),
    // All each patroller shows in the roster, in words.
    roster: patrollers.map(text),
    // The open patroller's card: what it does, when it works, and what it's on, if working.
    about: text(document.querySelector("[data-patroller-about]")),
    when: text(document.querySelector("[data-patroller-when]")),
    working: text(document.querySelector("[data-patroller-working]")),
    // A report's sentence, tag and time, apart.
    reports: (id: string) =>
      [...document.querySelectorAll(`[data-reports="${id}"] [data-report]`)].map((row) =>
        [...row.children].map(text).join(" "),
      ),
    openRole: text(
      document.querySelector("[data-patroller][data-open]")?.querySelector("[data-patroller-role]"),
    ),
    more: (id: string) => text(document.querySelector(`[data-reports="${id}"] [data-more]`)),
    // Each row's count of open findings, or "" without one.
    counts: patrollers.map((patroller) => text(patroller.querySelector("[data-findings-count]"))),
    // What the open patroller's popover shows, in order: findings, reports, dismissals.
    sections: [
      ...document.querySelectorAll("[data-findings], [data-reports], [data-dismissals]"),
    ].map((section) =>
      section.hasAttribute("data-findings")
        ? "findings"
        : section.hasAttribute("data-reports")
          ? "reports"
          : "dismissals",
    ),
    // A finding's sentence, tag and time, and its actions, apart.
    findings: (id: string) =>
      [...document.querySelectorAll(`[data-findings="${id}"] [data-finding]`)].map((row) => ({
        says: text(row.querySelector("[data-finding-sentence]")),
        actions: [...row.querySelectorAll("button")].map((button) => text(button)),
      })),
    dismissals: (id: string) =>
      [...document.querySelectorAll(`[data-dismissals="${id}"] [data-dismissal]`)].map((row) =>
        [...row.children].map(text).join(" "),
      ),
    // What each report leads to, by its accessible name, or null for one that leads nowhere.
    leads: (id: string) =>
      [...document.querySelectorAll(`[data-reports="${id}"] [data-report]`)].map((row) => {
        const control = row.querySelector("button, a, [role=button], [role=link], [tabindex]");
        return control ? control.getAttribute("aria-label") : null;
      }),
  };
}

void test("the Patrol lists patrollers in the order it's given, by role", () => {
  const shown = render({ patrolDraft: null, patrollers: [seoManager(), translator] });
  assert.deepEqual(shown.roles, ["SEO manager", "Translator"]);

  const swapped = render({ patrolDraft: null, patrollers: [translator, seoManager()] });
  assert.deepEqual(swapped.roles, ["Translator", "SEO manager"]);
});

void test("the roster shows each patroller by its role only, and its card introduces what it does and when", () => {
  const view = { patrolDraft: null, patrollers: [seoManager(), translator] };
  const closed = render(view);
  // Not when it last worked: its reports say that.
  assert.deepEqual(closed.roster, ["SEO manager", "Translator"]);

  const opened = render(view, { open: "seoManager" });
  assert.equal(
    opened.about,
    "Writes what search engines read: each page's SEO, and each file's alt text and filename.",
  );
  assert.equal(opened.when, "Runs as you edit");
  assert.equal(opened.working, "");
});

void test("a patroller's card tags when it works where the editor is: in a draft, or on Live", () => {
  const onLive = (patroller: PatrollerView) =>
    render({ patrolDraft: null, patrollers: [patroller] }, { open: patroller.id, inDraft: false })
      .when;

  assert.equal(onLive(seoManager({ duty: "off" })), "Doesn't run on Live");
  assert.equal(onLive(linkChecker({ duty: "asYouGo" })), "Runs every 6 hours");
  assert.equal(
    render({ patrolDraft: null, patrollers: [linkChecker()] }, { open: "linkChecker" }).when,
    "Runs when you publish",
  );
});

void test("in a single-locale project, the Translator's card invites the editor to add a language", () => {
  const shown = render(
    { patrolDraft: null, patrollers: [translator] },
    { open: "translator", singleLocale: true },
  );

  assert.equal(shown.when, "Runs once you add a language");
});

void test("a patroller's reports are closed until opened", () => {
  const closed = render({ patrolDraft: null, patrollers: [seoManager(), translator] });
  assert.deepEqual(closed.reports("seoManager"), []);
  assert.equal(closed.openRole, "");

  const opened = render(
    { patrolDraft: null, patrollers: [seoManager(), translator] },
    { open: "seoManager" },
  );
  assert.equal(opened.reports("seoManager").length, 3);
  assert.equal(opened.openRole, "SEO manager");
});

void test("an open patroller's reports read as sentences, failures as failures, with short times", () => {
  const shown = render({ patrolDraft: null, patrollers: [seoManager()] }, { open: "seoManager" });

  assert.deepEqual(shown.reports("seoManager"), [
    "Wrote SEO for Pricing in German 2m",
    "Couldn't write SEO for Pricing in French 5m",
    "Described team.png in English Live 1h",
  ]);
});

void test("Live's reports carry a Live tag in a draft only", () => {
  const shown = render(
    { patrolDraft: null, patrollers: [seoManager()] },
    { open: "seoManager", inDraft: false },
  );

  assert.equal(shown.reports("seoManager")[2], "Described team.png in English 1h");
});

void test("the Translator's reports read as translations, merges with Live's included", () => {
  const hero = { entity: "block" as const, id: "block-1", name: "hero" };
  const footer = { entity: "sharedContent" as const, id: "footer", name: "Footer" };
  const reports = [
    report("1", {
      summary: { kind: "structured", verb: "translated", subject: hero, locale: "es" },
    }),
    report("2", {
      summary: { kind: "structured", verb: "mergedWithLive", subject: hero, locale: "de" },
    }),
    report("3", {
      outcome: "failed",
      summary: { kind: "structured", verb: "translated", subject: footer, locale: "fr" },
    }),
    report("4", {
      live: true,
      summary: { kind: "structured", verb: "publishedCatchUp", subject: null, locale: null },
    }),
  ];
  const shown = render(
    { patrolDraft: null, patrollers: [{ ...translator, lastActivityAt: minutes(2), reports }] },
    { open: "translator" },
  );

  assert.deepEqual(shown.reports("translator"), [
    "Translated hero to Spanish 2m",
    "Translated hero to German 2m",
    "Couldn't translate Footer to French 2m",
    "Published the caught-up translations Live 2m",
  ]);
});

void test("an AI-written report shows as written", () => {
  const written = report("4", { summary: { kind: "text", text: "Checked every link on Pricing" } });
  const shown = render(
    { patrolDraft: null, patrollers: [seoManager({ reports: [written] })] },
    { open: "seoManager" },
  );

  assert.deepEqual(shown.reports("seoManager"), ["Checked every link on Pricing 2m"]);
});

void test("the reports not shown are counted by locale", () => {
  const shown = render(
    {
      patrolDraft: null,
      patrollers: [
        seoManager({
          more: [
            { locale: "de", count: 212 },
            { locale: "fr", count: 3 },
          ],
        }),
      ],
    },
    { open: "seoManager" },
  );

  assert.equal(shown.more("seoManager"), "…and 212 more in German, 3 in French");
});

const hero = { entity: "block" as const, id: "block-1", name: "hero" };

/**
 * Renders one patroller, and reads its working indicator and announced state, and what its card
 * says it's on.
 */
function renderOne(patroller: PatrollerView) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(
    <>
      <div data-roster>
        <PatrolRoster
          view={{ patrolDraft: null, patrollers: [patroller] }}
          now={now}
          inDraft
          singleLocale={false}
          open={null}
          onOpenChange={() => {}}
          onShow={() => {}}
          onApply={() => {}}
          onAsk={() => {}}
          onDismiss={() => {}}
          onOpenPatrolDraft={() => {}}
        />
      </div>
      <Popover open>
        <PatrollerCard
          patroller={patroller}
          now={now}
          inDraft
          singleLocale={false}
          patrolDraft={null}
          onShow={() => {}}
          onApply={() => {}}
          onAsk={() => {}}
          onDismiss={() => {}}
          onOpenPatrolDraft={() => {}}
        />
      </Popover>
    </>,
  );
  const row = document.querySelector("[data-patroller]")!;
  const text = (element: { textContent: string | null } | null) =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const button = row.querySelector("button")!;
  const live = row.querySelector('[aria-live="polite"], [role="status"]');
  const describedBy = button.getAttribute("aria-describedby");
  return {
    working: text(document.querySelector("[data-patroller-working]")),
    /** The polite live region's text, null without one. */
    announced: live && text(live),
    /** What the button reads as itself, without what it's described by. */
    buttonText: text(button),
    description: describedBy ? text(document.getElementById(describedBy)) : "",
    indicator: row.querySelector("[data-working-indicator]"),
    squareling: row.querySelector("[data-squareling]"),
  };
}

const translating = (working: PatrollerView["working"]): PatrollerView => ({
  ...translator,
  lastActivityAt: minutes(1),
  working,
});

void test("a working patroller's card names its one subject and the locale", () => {
  const shown = renderOne(translating({ subject: hero, locales: [{ locale: "es", count: 1 }] }));

  assert.equal(shown.working, "Translating hero into Spanish");
});

void test("a working patroller's card counts a burst into a locale", () => {
  const shown = renderOne(translating({ subject: null, locales: [{ locale: "de", count: 38 }] }));

  assert.equal(shown.working, "Translating 38 items into German");
});

void test("a burst across locales is counted in each locale, the most first", () => {
  const shown = renderOne(
    translating({
      subject: null,
      locales: [
        { locale: "de", count: 38 },
        { locale: "es", count: 12 },
      ],
    }),
  );

  assert.equal(shown.working, "Translating 38 items into German and 12 into Spanish");
});

void test("a burst across many locales names the first and counts the rest together", () => {
  const shown = renderOne(
    translating({
      subject: null,
      locales: [
        { locale: "de", count: 38 },
        { locale: "es", count: 12 },
        { locale: "fr", count: 5 },
        { locale: "it", count: 4 },
      ],
    }),
  );

  assert.equal(
    shown.working,
    "Translating 38 items into German, 12 into Spanish and 9 into 2 other languages",
  );
});

void test("a burst across three locales names each one", () => {
  const shown = renderOne(
    seoManager({
      working: {
        subject: null,
        locales: [
          { locale: "de", count: 3 },
          { locale: "es", count: 2 },
          { locale: "fr", count: 1 },
        ],
      },
    }),
  );

  assert.equal(shown.working, "Writing SEO for 3 items in German, 2 in Spanish and 1 in French");
});

void test("the SEO manager says what it's writing, or which file it's describing", () => {
  const writing = renderOne(
    seoManager({ working: { subject: pricing, locales: [{ locale: "fr", count: 1 }] } }),
  );
  assert.equal(writing.working, "Writing SEO for Pricing in French");

  const describing = renderOne(
    seoManager({ working: { subject: team, locales: [{ locale: "en", count: 1 }] } }),
  );
  assert.equal(describing.working, "Describing team.png in English");

  const burst = renderOne(
    seoManager({ working: { subject: null, locales: [{ locale: "de", count: 3 }] } }),
  );
  assert.equal(burst.working, "Writing SEO for 3 items in German");
});

void test("the avatar circle shows a working indicator only while working", () => {
  const working = renderOne(translating({ subject: hero, locales: [{ locale: "es", count: 1 }] }));
  assert.ok(working.indicator);
  assert.equal(working.indicator.getAttribute("aria-hidden"), "true");

  assert.equal(renderOne(seoManager()).indicator, null);
});

void test("each patroller shows its own squareling, never the agent's, with its idle face until it works", () => {
  const face = (patroller: PatrollerView) => {
    const { squareling } = renderOne(patroller);
    return {
      variant: squareling?.getAttribute("data-squareling-variant"),
      face: squareling?.getAttribute("data-squareling"),
    };
  };

  assert.deepEqual(face(translator), { variant: "translator", face: "idle" });
  assert.deepEqual(face(translating({ subject: hero, locales: [{ locale: "es", count: 1 }] })), {
    variant: "translator",
    face: "working",
  });
  assert.deepEqual(face(seoManager()), { variant: "seoManager", face: "idle" });
  assert.deepEqual(
    face(seoManager({ working: { subject: null, locales: [{ locale: "de", count: 3 }] } })),
    {
      variant: "seoManager",
      face: "working",
    },
  );
});

void test("a patroller off where the editor is shows asleep, and working whenever it works there", () => {
  const face = (patroller: PatrollerView) =>
    renderOne(patroller).squareling?.getAttribute("data-squareling");

  assert.equal(face(seoManager({ duty: "off" })), "asleep");
  assert.equal(face({ ...translator, duty: "off" }), "asleep");
  assert.equal(
    face(
      seoManager({
        duty: "off",
        working: { subject: pricing, locales: [{ locale: "de", count: 1 }] },
      }),
    ),
    "working",
  );
  assert.equal(face(seoManager({ duty: "atPublish" })), "idle");
});

void test("an asleep patroller still opens its popover, with its reports", () => {
  const shown = render(
    { patrolDraft: null, patrollers: [seoManager({ duty: "off" })] },
    { open: "seoManager" },
  );

  assert.equal(shown.openRole, "SEO manager");
  assert.deepEqual(shown.reports("seoManager"), [
    "Wrote SEO for Pricing in German 2m",
    "Couldn't write SEO for Pricing in French 5m",
    "Described team.png in English Live 1h",
  ]);
});

void test("assistive technology hears the working state in words as it changes, once", () => {
  const working = renderOne(translating({ subject: hero, locales: [{ locale: "es", count: 1 }] }));
  assert.equal(working.announced, "Working: translating hero into Spanish");
  // Focusing the patroller reads it too, as its description rather than a second time in its name.
  assert.equal(working.description, "Working: translating hero into Spanish");
  assert.doesNotMatch(working.buttonText, /Working/);

  // An idle patroller's live region is there, empty, so that starting work is announced.
  const idle = renderOne(seoManager());
  assert.equal(idle.announced, "");
  assert.equal(idle.description, "");
});

void test("an open patroller stays open when it moves", () => {
  const before = render(
    { patrolDraft: null, patrollers: [seoManager(), translator] },
    { open: "translator" },
  );
  const after = render(
    { patrolDraft: null, patrollers: [translator, seoManager()] },
    { open: "translator" },
  );

  assert.equal(before.openRole, "Translator");
  assert.equal(after.openRole, "Translator");
});

const onPricing = { kind: "page" as const, pageId: "page-1", blockId: null, itemId: null };

void test("a report leads to where its subject shows, named so, and one without a place leads nowhere", () => {
  const hero = { entity: "block" as const, id: "block-1", name: "hero" };
  const welcome = { entity: "record" as const, id: "record-1", name: "Welcome" };
  const reports = [
    report("1", {
      summary: { kind: "structured", verb: "wroteSeo", subject: pricing, locale: "de" },
      place: onPricing,
    }),
    report("2", {
      summary: { kind: "structured", verb: "translated", subject: hero, locale: "es" },
      place: { ...onPricing, blockId: "block-1" },
    }),
    report("3", {
      summary: { kind: "structured", verb: "translated", subject: welcome, locale: "fr" },
      place: { kind: "record", collectionId: "articles", recordId: "record-1" },
    }),
    report("4", {
      summary: { kind: "structured", verb: "describedFile", subject: team, locale: "en" },
      place: { kind: "file", fileId: "file-1" },
    }),
    report("5", {
      live: true,
      summary: { kind: "structured", verb: "publishedCatchUp", subject: null, locale: null },
    }),
    report("6", { summary: { kind: "text", text: "Checked every link on Pricing" } }),
  ];
  const shown = render(
    { patrolDraft: null, patrollers: [seoManager({ reports })] },
    { open: "seoManager", inDraft: false },
  );

  assert.deepEqual(shown.leads("seoManager"), [
    "Wrote SEO for Pricing in German: show it on the Canvas in German",
    "Translated hero to Spanish: show it on the Canvas in Spanish",
    "Translated Welcome to French: open it in French",
    "Described team.png in English: open the file",
    null,
    null,
  ]);
});

void test("a Live report seen from a draft leads to Live", () => {
  const reports = [
    report("1", {
      live: true,
      summary: { kind: "structured", verb: "wroteSeo", subject: pricing, locale: "de" },
      place: onPricing,
    }),
    report("2", {
      live: true,
      summary: { kind: "structured", verb: "describedFile", subject: team, locale: "en" },
      place: { kind: "file", fileId: "file-1" },
    }),
  ];
  const view = { patrolDraft: null, patrollers: [seoManager({ reports })] };

  assert.deepEqual(render(view, { open: "seoManager" }).leads("seoManager"), [
    "Wrote SEO for Pricing in German: show it on Live's Canvas in German",
    "Described team.png in English: open the file on Live",
  ]);
  assert.deepEqual(render(view, { open: "seoManager", inDraft: false }).leads("seoManager"), [
    "Wrote SEO for Pricing in German: show it on the Canvas in German",
    "Described team.png in English: open the file",
  ]);
});

void test("a patroller that checks at publish says what it's on while working, and nothing while idle", () => {
  const idle = render({ patrolDraft: null, patrollers: [linkChecker()] }, { open: "linkChecker" });
  assert.equal(idle.working, "");

  const working = render(
    {
      patrolDraft: null,
      patrollers: [
        linkChecker({ working: { subject: footer, locales: [{ locale: "en", count: 1 }] } }),
      ],
    },
    { open: "linkChecker" },
  );
  assert.equal(working.working, "Checking links in Footer in English");
});

void test("a patroller's open findings are counted at the end of its row, and a row without any shows no count", () => {
  const shown = render({
    patrolDraft: null,
    patrollers: [
      linkChecker({ findings: [finding(1), finding(2, { field: "link" })] }),
      translator,
    ],
  });

  assert.deepEqual(shown.counts, ["2", ""]);
  assert.deepEqual(
    render({ patrolDraft: null, patrollers: [linkChecker({ findings: [finding(1)] })] }).counts,
    ["1"],
  );
});

void test("the popover lists open findings above reports, each with what it's about and its actions", () => {
  const shown = render(
    {
      patrolDraft: null,
      patrollers: [linkChecker({ findings: [finding(1), finding(2, { place: null, fix: null })] })],
    },
    { open: "linkChecker" },
  );

  assert.deepEqual(shown.sections, ["findings", "reports"]);
  assert.deepEqual(shown.findings("linkChecker"), [
    {
      says: "\u201cAbout us\u201d in Footer links to About, a page that no longer exists",
      actions: ["Show", "Remove the link", "Ask the agent", "Dismiss"],
    },
    {
      says: "\u201cAbout us\u201d in Footer links to About, a page that no longer exists",
      actions: ["Ask the agent", "Dismiss"],
    },
  ]);
  assert.deepEqual(shown.reports("linkChecker"), ["Removed a link in Footer in English 10m"]);
});

void test("a broken link reads its url and how it failed, and is dismissed as a link that's fine", () => {
  const shown = render(
    {
      patrolDraft: null,
      patrollers: [
        linkChecker({
          findings: [
            finding(1, {
              about: {
                kind: "brokenLink",
                url: "https://partner.example.com/",
                text: "Our partner",
                failure: { kind: "status", status: 404 },
              },
              fix: null,
            }),
          ],
        }),
      ],
    },
    { open: "linkChecker" },
  );

  assert.deepEqual(shown.findings("linkChecker"), [
    {
      says: "\u201cOur partner\u201d in Footer links to https://partner.example.com/, which answers with an error (404)",
      actions: ["Show", "Ask the agent", "This link is fine"],
    },
  ]);
});

void test("Live's findings can't be applied or handed to the agent: they're fixed in the Patrol Draft", () => {
  const shown = render(
    {
      patrolDraft: null,
      patrollers: [linkChecker({ duty: "asYouGo", findings: [finding(1, { live: true })] })],
    },
    { open: "linkChecker", inDraft: false },
  );

  assert.deepEqual(
    shown.findings("linkChecker").map(({ actions }) => actions),
    [["Show", "Dismiss"]],
  );
});

void test("on Live, findings lead to the open Patrol Draft, where they're fixed", () => {
  const patrolDraft = { id: "draft-1", name: "Patrol" };
  const shown = render(
    {
      patrollers: [linkChecker({ duty: "asYouGo", findings: [finding(1, { live: true })] })],
      patrolDraft,
    },
    { open: "linkChecker", inDraft: false },
  );

  assert.deepEqual(
    shown.findings("linkChecker").map(({ actions }) => actions),
    [["Show", "Open the Patrol Draft", "Dismiss"]],
  );
});

void test("the popover shows the history of dismissals: what, who, and when", () => {
  const shown = render(
    { patrolDraft: null, patrollers: [linkChecker({ dismissals: [dismissal(1)] })] },
    { open: "linkChecker" },
  );

  assert.deepEqual(shown.sections, ["reports", "dismissals"]);
  assert.deepEqual(shown.dismissals("linkChecker"), ["Links to Team: dismissed by Ada 1h"]);
});
