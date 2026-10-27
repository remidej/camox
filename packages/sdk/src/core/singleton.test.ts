import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "./createApp";
import { createLayout } from "./createLayout";

const options = {
  title: "Pokédex",
  description: "A code-owned page",
  blocks: { before: [], after: [] },
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toReact: () => null,
  toDescription: ({ page }: { page: { description: string | undefined } }) => page.description,
};

void test("singletons sync their kind and do not seed curated pages", async () => {
  const singleton = createLayout("pokedex")({ ...options, kind: "singleton" });
  const app = createApp({ blocks: [], layouts: [singleton] });
  const set = await app.getDefinitionSet();
  assert.equal(set.homepage, null);
  assert.equal(set.layouts[0].kind, "singleton");
  const curated = createLayout("default")({ ...options, kind: "curated" });
  assert.equal(
    (await createApp({ blocks: [], layouts: [singleton, curated] }).getDefinitionSet()).homepage
      ?.layoutId,
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
