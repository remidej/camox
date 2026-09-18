import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "./createApp";
import { createLayout } from "./createLayout";

const options = {
  title: "Pokédex",
  description: "A code-owned page",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
  component: () => null,
};

void test("singletons sync their kind, accept no loader, and do not seed curated pages", () => {
  const singleton = createLayout("pokedex")({ ...options, kind: "singleton" });
  const app = createApp({ blocks: [], layouts: [singleton] });
  assert.equal(app.getInitialPageBundles(), null);
  assert.equal(singleton._internal.loader, undefined);
  assert.equal(app.getSerializableLayoutDefinitions()[0].kind, "singleton");
  const curated = createLayout("default")({ ...options, kind: "curated" });
  assert.equal(
    createApp({ blocks: [], layouts: [singleton, curated] }).getInitialPageBundles()?.layoutId,
    "default",
  );
});

void test("singleton definitions reject parameterized or malformed file routes", () => {
  for (const id of [
    "pokemon.$name",
    "pokemon..featured",
    "pokemon/featured",
    "",
    "pokemon?query",
  ]) {
    assert.throws(() => createLayout(id)({ ...options, kind: "singleton" }), /fixed file route/);
  }
});

void test("the legacy object API cannot bypass singleton initial-block validation", () => {
  assert.throws(
    () =>
      createLayout({
        ...options,
        id: "pokedex",
        kind: "singleton",
        blocks: { before: [], after: [], initial: [] },
      }),
    /cannot define initial page blocks/,
  );
});
