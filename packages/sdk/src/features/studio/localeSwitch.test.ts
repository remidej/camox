import assert from "node:assert/strict";
import { test } from "node:test";

import { pathInLocale } from "./localeSwitch";

const english = [
  { id: "home", fullPath: "/" },
  { id: "pricing", fullPath: "/pricing" },
  { id: "careers", fullPath: "/careers" },
];
const german = [
  { id: "home", fullPath: "/" },
  { id: "pricing", fullPath: "/preise" },
];
const singleton = (path: string) => path === "/search";

void test("switching locales keeps the same page, at its path in the other locale", () => {
  assert.equal(pathInLocale("/pricing", { shown: english, target: german, singleton }), "/preise");
  assert.equal(pathInLocale("/preise", { shown: german, target: english, singleton }), "/pricing");
});

void test("switching to a locale missing the page goes to that locale's home", () => {
  assert.equal(pathInLocale("/careers", { shown: english, target: german, singleton }), "/");
  assert.equal(pathInLocale("/articles/hello", { shown: english, target: german, singleton }), "/");
});

void test("switching locales on a record page goes to the record's page in the other locale", () => {
  const options = { shown: english, target: german, singleton };
  assert.equal(
    pathInLocale("/articles/hello", { ...options, recordPath: "/articles/hallo" }),
    "/articles/hallo",
  );
  // A curated page on the record page's path is the page shown.
  assert.equal(pathInLocale("/pricing", { ...options, recordPath: "/articles/hallo" }), "/preise");
});

void test("studio routes and singleton pages keep their code-owned path in every locale", () => {
  for (const path of ["/camox/content/assets", "/camox/canvas", "/search"])
    assert.equal(pathInLocale(path, { shown: english, target: german, singleton }), path);
});
