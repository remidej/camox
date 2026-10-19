import assert from "node:assert/strict";
import { test } from "node:test";

import { localeOptions } from "./localeOptions";

const tags = (existing: { tag: string; isDefault: boolean }[]) =>
  localeOptions(existing).map((option) => option.tag);

void test("the locales offered to add leave out the project's locales, whatever their case", () => {
  const offered = tags([
    { tag: "en", isDefault: true },
    { tag: "pt-br", isDefault: false },
  ]);
  assert.ok(!offered.includes("en"));
  assert.ok(!offered.includes("pt-BR"));
  assert.ok(offered.includes("de"));
  assert.ok(offered.includes("pt-PT"));
});

void test("the locales offered to add are canonical tags, named and ordered by name", () => {
  const options = localeOptions([]);
  for (const { tag } of options) assert.deepEqual(Intl.getCanonicalLocales(tag), [tag]);
  const names = options.map((option) => option.label);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.equal(options.find((option) => option.tag === "de")?.label, "German (de)");
});
