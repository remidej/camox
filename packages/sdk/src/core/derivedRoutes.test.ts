import assert from "node:assert/strict";
import { test } from "node:test";

import type { Layout } from "./createLayout";
import { matchDerivedLayout } from "./derivedRoutes.ts";

function layout(id: string, kind: "curated" | "derived" | "singleton" = "derived") {
  return { _internal: { id, kind } } as Layout;
}

void test("matches decoded named parameters without matching curated identities", () => {
  const layouts = [layout("pokemon.$name"), layout("curated.$name", "curated")];
  assert.deepEqual(matchDerivedLayout(layouts, "/pokemon/mr%20mime/")?.params, { name: "mr mime" });
  assert.equal(matchDerivedLayout(layouts, "/curated/pikachu"), null);
  assert.equal(matchDerivedLayout(layouts, "/pokemon"), null);
  assert.equal(matchDerivedLayout(layouts, "/pokemon/pikachu/extra"), null);
});

void test("rejects malformed escapes and encoded slashes", () => {
  const layouts = [layout("pokemon.$name")];
  for (const path of ["/pokemon/%ZZ", "/pokemon/%2F", "/pokemon/"]) {
    assert.equal(matchDerivedLayout(layouts, path), null);
  }
});

void test("singleton routes match exactly and take precedence over derived parameters", () => {
  const singleton = layout("pokemon.featured", "singleton");
  const layouts = [layout("pokemon.$name"), singleton];
  assert.equal(matchDerivedLayout(layouts, "/pokemon/featured")?.layout, singleton);
  assert.deepEqual(matchDerivedLayout(layouts, "/pokemon/featured/")?.params, {});
  assert.equal(matchDerivedLayout(layouts, "/pokemon/featured/extra"), null);
  assert.equal(matchDerivedLayout(layouts, "/pokemon/pikachu")?.layout, layouts[0]);
});

void test("static routes take precedence over parameters", () => {
  const specific = layout("pokemon.featured");
  assert.equal(
    matchDerivedLayout([layout("pokemon.$name"), specific], "/pokemon/featured")?.layout,
    specific,
  );
});
