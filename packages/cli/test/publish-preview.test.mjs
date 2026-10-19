import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPreview } from "../src/lib/publish-preview.ts";

// The publish preview as `camox publish` prints it in a terminal (ADR 0009).

const PAGE = { kind: "page", id: "page-1", path: "/about", nickname: "About" };

const preview = (changes) => ({
  blockers: [],
  conflicts: [],
  lost: [],
  warnings: [],
  changes,
  translating: [],
  defaultLocale: "en",
  token: "token-0",
});

const hero = { entity: "block", id: "block-1", label: "Hero", owner: PAGE, change: "changed" };

void test("groups changes under their locale, the default locale first", () => {
  const printed = formatPreview(
    preview([
      { ...hero, locale: "fr" },
      { ...hero, locale: "de" },
      {
        entity: "locale",
        id: "locale-1",
        label: "de",
        owner: null,
        locale: null,
        change: "created",
      },
      { ...hero, id: "block-2", label: "Quote", locale: "en" },
    ]),
  );

  const changes = printed.slice(printed.indexOf("Changes (4)"), printed.indexOf("Token:"));
  assert.equal(
    changes,
    [
      "Changes (4)",
      "  en",
      '    - changed block "Quote" on page /about',
      "  de",
      '    - changed block "Hero" on page /about',
      "  fr",
      '    - changed block "Hero" on page /about',
      "  Every locale",
      '    - created locale "de"',
      "",
      "",
    ].join("\n"),
  );
});

void test("names no locale for a draft changing only its default locale", () => {
  const printed = formatPreview(preview([{ ...hero, locale: "en" }]));

  assert.match(printed, /Changes \(1\)\n {2}- changed block "Hero" on page \/about\n/);
});
