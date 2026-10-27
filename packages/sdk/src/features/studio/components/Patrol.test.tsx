import assert from "node:assert/strict";
import { test } from "node:test";

import type { PatrollerView, PatrolView, ReportView } from "@camox/api-contract/patrol";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { PatrolRoster } = await import("./Patrol");

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
function render(view: PatrolView, options: { expanded?: string[]; inDraft?: boolean } = {}) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(
    <PatrolRoster
      view={view}
      now={now}
      inDraft={options.inDraft ?? true}
      expanded={new Set(options.expanded ?? [])}
      onToggle={() => {}}
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
    more: (id: string) => text(document.querySelector(`[data-patroller="${id}"] [data-more]`)),
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
