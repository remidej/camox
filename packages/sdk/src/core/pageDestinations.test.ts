import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isValidTextLinkTarget,
  resolveTextLinkHref,
  shouldOpenTextLinkInNewTab,
} from "./lib/textLinks";
import { destinationLink, destinationTextLink, getPageDestinations } from "./pageDestinations";

const layouts = [
  { _internal: { kind: "singleton" as const, id: "guide.pokedex", title: "Pokédex" } },
  { _internal: { kind: "derived" as const, id: "pokemon.$name", title: "Pokémon" } },
  { _internal: { kind: "curated" as const, id: "marketing", title: "Marketing" } },
];

void test("destination lists include concrete singletons, never layout templates or derived families", () => {
  const destinations = getPageDestinations(
    [{ id: 1, nickname: "About", fullPath: "/about" }],
    layouts,
  );
  assert.deepEqual(destinations, [
    { key: "page:1", kind: "curated", pageId: 1, title: "About", fullPath: "/about" },
    {
      key: "singleton:guide.pokedex",
      kind: "singleton",
      layoutId: "guide.pokedex",
      title: "Pokédex",
      fullPath: "/guide/pokedex",
    },
  ]);
  assert.deepEqual(destinationLink(destinations[0]), { type: "page", pageId: "1" });
  assert.equal(destinationTextLink(destinations[0]), "camox:page:1");
  assert.deepEqual(destinationLink(destinations[1]), { type: "external", href: "/guide/pokedex" });
  assert.equal(destinationTextLink(destinations[1]), "/guide/pokedex");
  assert.equal(getPageDestinations([], layouts).length, 1, "Singleton-only apps remain navigable");
});

void test("singleton text links resolve without page records and stay in the current tab", () => {
  assert.ok(isValidTextLinkTarget("/guide/pokedex"));
  assert.equal(resolveTextLinkHref("/guide/pokedex", undefined, "/current"), "/guide/pokedex");
  assert.equal(shouldOpenTextLinkInNewTab("/guide/pokedex"), false);
  assert.equal(
    resolveTextLinkHref("camox:page:1", [{ id: 1, fullPath: "/about" }], "/current"),
    "/about",
  );
  for (const unsafe of [
    "//evil.test",
    "/\\evil.test",
    "/\nevil.test",
    "javascript:alert(1)",
    "data:text/html,evil",
  ]) {
    assert.equal(isValidTextLinkTarget(unsafe), false, unsafe);
    assert.equal(resolveTextLinkHref(unsafe, undefined, "/current"), null, unsafe);
  }
});
