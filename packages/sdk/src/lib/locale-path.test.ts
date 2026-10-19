import assert from "node:assert/strict";
import { test } from "node:test";

import { localePrefix, localizedPath, parseLocalePath, type LocaleView } from "./locale-path";

const en: LocaleView = { tag: "en", isDefault: true };
const de: LocaleView = { tag: "de", isDefault: false };
const ptBr: LocaleView = { tag: "pt-BR", isDefault: false };
const locales = [en, de, ptBr];

void test("a locale's prefix is its tag in lowercase, and the default locale has none", () => {
  assert.equal(localePrefix(en), "");
  assert.equal(localePrefix(de), "/de");
  assert.equal(localePrefix(ptBr), "/pt-br");
});

void test("a path under a locale's prefix names that locale and the path after the prefix", () => {
  assert.deepEqual(parseLocalePath("/de/preise", locales), { locale: de, path: "/preise" });
  assert.deepEqual(parseLocalePath("/pt-br/precos/planos", locales), {
    locale: ptBr,
    path: "/precos/planos",
  });
  assert.deepEqual(parseLocalePath("/de/camox/content", locales), {
    locale: de,
    path: "/camox/content",
  });
});

void test("a locale's home is its bare prefix, with or without a trailing slash", () => {
  assert.deepEqual(parseLocalePath("/de", locales), { locale: de, path: "/" });
  assert.deepEqual(parseLocalePath("/de/", locales), { locale: de, path: "/" });
});

void test("paths without a locale's prefix are the default locale's", () => {
  assert.deepEqual(parseLocalePath("/", locales), { locale: en, path: "/" });
  assert.deepEqual(parseLocalePath("/pricing", locales), { locale: en, path: "/pricing" });
  // Only a whole first segment names a locale.
  assert.deepEqual(parseLocalePath("/design", locales), { locale: en, path: "/design" });
  // The default locale has no prefix, so its tag is a page path like any other.
  assert.deepEqual(parseLocalePath("/en/about", locales), { locale: en, path: "/en/about" });
  // Prefixes are lowercase.
  assert.deepEqual(parseLocalePath("/DE/preise", locales), { locale: en, path: "/DE/preise" });
});

void test("parsing a locale path leaves out the search and hash", () => {
  assert.deepEqual(parseLocalePath("/de/preise?camox-draft=abc#plans", locales), {
    locale: de,
    path: "/preise",
  });
  assert.deepEqual(parseLocalePath("/de?camox-draft=abc", locales), { locale: de, path: "/" });
});

void test("a locale-relative path goes under its locale's prefix, keeping search and hash", () => {
  assert.equal(localizedPath("/preise", de), "/de/preise");
  assert.equal(localizedPath("/", de), "/de");
  assert.equal(localizedPath("/?camox-draft=abc", de), "/de?camox-draft=abc");
  assert.equal(localizedPath("/precos#plans", ptBr), "/pt-br/precos#plans");
  assert.equal(localizedPath("/pricing", en), "/pricing");
  assert.equal(localizedPath("/", en), "/");
});

void test("a localized path parses back to its locale and path", () => {
  for (const locale of locales) {
    for (const path of ["/", "/a", "/a/b"]) {
      assert.deepEqual(parseLocalePath(localizedPath(path, locale), locales), { locale, path });
    }
  }
});
