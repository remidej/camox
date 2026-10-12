import assert from "node:assert/strict";
import { test } from "node:test";

import type { Layout } from "./createLayout";
import { derivedLayoutPath, discoverLayoutPaths, matchDerivedLayout } from "./derivedRoutes.ts";
import { createRequestContext } from "./requestContext";

const liveContext = createRequestContext({ source: "live" });

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

void test("discovered params become paths the runtime matches back to the same params", async () => {
  const params = [
    { name: "mr mime", form: "galar" },
    { name: "farfetch'd", form: "100%" },
  ];
  const discovering = {
    _internal: {
      id: "pokemon.$name.forms.$form",
      kind: "derived",
      routes: async () => ({ data: params.map((entry) => ({ params: entry })) }),
    },
  } as unknown as Layout;
  const paths = await discoverLayoutPaths(discovering, liveContext);
  assert.deepEqual(
    paths.map((path) => matchDerivedLayout([discovering], path)?.params),
    params,
  );
});

void test("rejects discovered params the route could not match", async () => {
  for (const params of [{}, { name: "" }, { name: "a/b" }, { name: 1 }, { name: "a", extra: "b" }])
    assert.throws(() => derivedLayoutPath("pokemon.$name", params), /pokemon\.\$name/);
  const invalid = { _internal: { id: "pokemon.$name", kind: "derived", routes: () => ({}) } };
  await assert.rejects(
    discoverLayoutPaths(invalid as unknown as Layout, liveContext),
    /pokemon\.\$name/,
  );
});
