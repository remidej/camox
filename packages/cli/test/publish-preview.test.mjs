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
  token: "token-0",
});

void test("prints the locale of each change", () => {
  const hero = { entity: "block", id: "block-1", label: "Hero", owner: PAGE, change: "changed" };

  const printed = formatPreview(
    preview([
      { ...hero, locale: "en" },
      { ...hero, locale: "de" },
      {
        entity: "locale",
        id: "locale-1",
        label: "de",
        owner: null,
        locale: null,
        change: "created",
      },
    ]),
  );

  assert.match(printed, /- changed block "Hero" on page \/about \[en\]\n/);
  assert.match(printed, /- changed block "Hero" on page \/about \[de\]\n/);
  assert.match(printed, /- created locale "de"\n/);
});
