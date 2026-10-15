import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isValidTextLinkTarget,
  resolveTextLinkHref,
  shouldOpenTextLinkInNewTab,
} from "./lib/textLinks";
import { destinationLink, destinationTextLink, getPageDestinations } from "./pageDestinations";

const ABOUT_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";

const layouts = [
  { _internal: { kind: "singleton" as const, id: "guide.pokedex", title: "Pokédex" } },
  { _internal: { kind: "derived" as const, id: "pokemon.$name", title: "Pokémon" } },
  { _internal: { kind: "curated" as const, id: "marketing", title: "Marketing" } },
];

void test("destination lists include concrete singletons, never derived layouts or their pages", () => {
  const destinations = getPageDestinations(
    [{ id: ABOUT_ID, nickname: "About", fullPath: "/about" }],
    layouts,
  );
  assert.deepEqual(destinations, [
    {
      key: `page:${ABOUT_ID}`,
      kind: "curated",
      pageId: ABOUT_ID,
      title: "About",
      fullPath: "/about",
    },
    {
      key: "singleton:guide.pokedex",
      kind: "singleton",
      layoutId: "guide.pokedex",
      title: "Pokédex",
      fullPath: "/guide/pokedex",
    },
  ]);
  assert.deepEqual(destinationLink(destinations[0]), { type: "page", pageId: ABOUT_ID });
  assert.equal(destinationTextLink(destinations[0]), `camox:page:${ABOUT_ID}`);
  assert.deepEqual(destinationLink(destinations[1]), { type: "external", href: "/guide/pokedex" });
  assert.equal(destinationTextLink(destinations[1]), "/guide/pokedex");
  assert.equal(getPageDestinations([], layouts).length, 1, "Singleton-only apps remain navigable");
});

void test("pages that need a layout or that a singleton shadows aren't destinations", () => {
  const destinations = getPageDestinations(
    [
      { id: ABOUT_ID, nickname: "About", fullPath: "/about" },
      { id: "2", nickname: "Orphan", fullPath: "/orphan", needsLayout: true },
      { id: "3", nickname: "Old Pokédex", fullPath: "/guide/pokedex", shadowed: true },
    ],
    layouts,
  );
  assert.deepEqual(
    destinations.map((destination) => destination.key),
    [`page:${ABOUT_ID}`, "singleton:guide.pokedex"],
  );
});

void test("singleton text links resolve without page records and stay in the current tab", () => {
  assert.ok(isValidTextLinkTarget("/guide/pokedex"));
  assert.equal(resolveTextLinkHref("/guide/pokedex", undefined, "/current"), "/guide/pokedex");
  assert.equal(shouldOpenTextLinkInNewTab("/guide/pokedex"), false);
  assert.equal(
    resolveTextLinkHref(
      `camox:page:${ABOUT_ID}`,
      [{ id: ABOUT_ID, fullPath: "/about" }],
      "/current",
    ),
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
