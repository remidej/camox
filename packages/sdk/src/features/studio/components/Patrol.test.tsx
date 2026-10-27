import assert from "node:assert/strict";
import { test } from "node:test";

import type { PatrollerView, PatrolView, ReportView } from "@camox/api-contract/patrol";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { PatrolRoster, inHeldOrder } = await import("./Patrol");

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
  attention: "none",
  at: minutes(2),
  live: false,
  place: null,
  ...overrides,
});

const seoManager = (overrides: Partial<PatrollerView> = {}): PatrollerView => ({
  id: "seoManager",
  role: "SEO manager",
  working: null,
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
  ...overrides,
});

const translator: PatrollerView = {
  id: "translator",
  role: "Translator",
  working: null,
  lastActivityAt: null,
  reports: [],
  more: [],
};

/** Renders the Patrol into a document, to read it as editors do. */
function render(
  view: PatrolView,
  options: { expanded?: string[]; inDraft?: boolean; singleLocale?: boolean } = {},
) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(
    <PatrolRoster
      view={view}
      now={now}
      inDraft={options.inDraft ?? true}
      singleLocale={options.singleLocale ?? false}
      expanded={new Set(options.expanded ?? [])}
      onToggle={() => {}}
      onShow={() => {}}
    />,
  );
  const patrollers = [...document.querySelectorAll("[data-patroller]")];
  const text = (element: { textContent: string | null } | null | undefined) =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    roles: patrollers.map((patroller) => text(patroller.querySelector("[data-patroller-role]"))),
    subtitles: patrollers.map((patroller) =>
      text(patroller.querySelector("[data-patroller-subtitle]")),
    ),
    // A report's sentence, tag and time, apart.
    reports: (id: string) =>
      [...document.querySelectorAll(`[data-patroller="${id}"] [data-report]`)].map((row) =>
        [...row.children].map(text).join(" "),
      ),
    expandedRole: text(
      document.querySelector('[aria-expanded="true"]')?.querySelector("[data-patroller-role]"),
    ),
    more: (id: string) => text(document.querySelector(`[data-patroller="${id}"] [data-more]`)),
    // What each report leads to, by its accessible name, or null for one that leads nowhere.
    leads: (id: string) =>
      [...document.querySelectorAll(`[data-patroller="${id}"] [data-report]`)].map((row) => {
        const control = row.querySelector("button, a, [role=button], [role=link], [tabindex]");
        return control ? control.getAttribute("aria-label") : null;
      }),
  };
}

void test("the Patrol lists patrollers in the order it's given, by role", () => {
  const shown = render({ patrollers: [seoManager(), translator] });
  assert.deepEqual(shown.roles, ["SEO manager", "Translator"]);

  const swapped = render({ patrollers: [translator, seoManager()] });
  assert.deepEqual(swapped.roles, ["Translator", "SEO manager"]);
});

void test("an idle patroller says when it last worked, and one that never worked says nothing", () => {
  const shown = render({ patrollers: [seoManager(), translator] });

  assert.deepEqual(shown.subtitles, ["2 minutes ago", ""]);
});

void test("in a single-locale project, the Translator invites the editor to add a language, whenever it last worked", () => {
  const worked = { ...translator, lastActivityAt: minutes(2) };
  const shown = render({ patrollers: [seoManager(), worked] }, { singleLocale: true });

  assert.deepEqual(shown.subtitles, ["2 minutes ago", "Add a language to translate into"]);
});

void test("patrollers are collapsed until expanded", () => {
  const collapsed = render({ patrollers: [seoManager(), translator] });
  assert.deepEqual(collapsed.reports("seoManager"), []);

  const expanded = render({ patrollers: [seoManager(), translator] }, { expanded: ["seoManager"] });
  assert.equal(expanded.reports("seoManager").length, 3);
});

void test("an expanded patroller's reports read as sentences, failures as failures, with short times", () => {
  const shown = render({ patrollers: [seoManager()] }, { expanded: ["seoManager"] });

  assert.deepEqual(shown.reports("seoManager"), [
    "Wrote SEO for Pricing in German 2m",
    "Couldn't write SEO for Pricing in French 5m",
    "Described team.png in English Live 1h",
  ]);
});

void test("Live's reports carry a Live tag in a draft only", () => {
  const shown = render(
    { patrollers: [seoManager()] },
    { expanded: ["seoManager"], inDraft: false },
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
    { patrollers: [{ ...translator, lastActivityAt: minutes(2), reports }] },
    { expanded: ["translator"] },
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
    { patrollers: [seoManager({ reports: [written] })] },
    { expanded: ["seoManager"] },
  );

  assert.deepEqual(shown.reports("seoManager"), ["Checked every link on Pricing 2m"]);
});

void test("the reports not shown are counted by locale", () => {
  const shown = render(
    {
      patrollers: [
        seoManager({
          more: [
            { locale: "de", count: 212 },
            { locale: "fr", count: 3 },
          ],
        }),
      ],
    },
    { expanded: ["seoManager"] },
  );

  assert.equal(shown.more("seoManager"), "…and 212 more in German, 3 in French");
});

void test("without a held order, the Patrol shows the order it's given", () => {
  const view = { patrollers: [translator, seoManager()] };

  assert.deepEqual(
    inHeldOrder(view, null).patrollers.map(({ id }) => id),
    ["translator", "seoManager"],
  );
});

void test("a held order keeps patrollers in place but shows their latest content", () => {
  const working = seoManager({ lastActivityAt: minutes(0) });

  const shown = inHeldOrder({ patrollers: [working, translator] }, ["translator", "seoManager"]);

  assert.deepEqual(
    shown.patrollers.map(({ id }) => id),
    ["translator", "seoManager"],
  );
  assert.equal(shown.patrollers[1], working);
});

void test("a patroller missing from the held order shows after the held ones, and a gone one is dropped", () => {
  const shown = inHeldOrder({ patrollers: [seoManager(), translator] }, [
    "translator",
    "gone" as PatrollerView["id"],
  ]);

  assert.deepEqual(
    shown.patrollers.map(({ id }) => id),
    ["translator", "seoManager"],
  );
});

void test("an expanded patroller stays expanded when it moves", () => {
  const expanded = ["translator"];
  const before = render({ patrollers: [seoManager(), translator] }, { expanded });
  const after = render({ patrollers: [translator, seoManager()] }, { expanded });

  assert.equal(before.expandedRole, "Translator");
  assert.equal(after.expandedRole, "Translator");
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
    { patrollers: [seoManager({ reports })] },
    { expanded: ["seoManager"], inDraft: false },
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
  const view = { patrollers: [seoManager({ reports })] };

  assert.deepEqual(render(view, { expanded: ["seoManager"] }).leads("seoManager"), [
    "Wrote SEO for Pricing in German: show it on Live's Canvas in German",
    "Described team.png in English: open the file on Live",
  ]);
  assert.deepEqual(render(view, { expanded: ["seoManager"], inDraft: false }).leads("seoManager"), [
    "Wrote SEO for Pricing in German: show it on the Canvas in German",
    "Described team.png in English: open the file",
  ]);
});
