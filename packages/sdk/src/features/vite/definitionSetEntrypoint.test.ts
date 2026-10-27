import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createLogger, createServer } from "vite-plus";

import { DEFINITION_SET_ENTRYPOINT } from "../runtime/definitionSetEntrypoint";
import { loadDefinitionSet } from "./definitionsSync";
import { FIXTURE_PROJECT_ID, type FixtureBuild, buildFixtureApp } from "./fixtureApp";
import { camox } from "./vite";

/** Only the Definition Set names it: no page or studio renders a layout's description. */
const LAYOUT_DESCRIPTION = "A layout only the Definition Set describes";

/** The fixture's hero, plus a layout with a layout-only navbar and initial blocks, and a collection. */
const FILES = {
  "src/blocks/navbar.tsx": `import { createBlock } from "camox/createBlock";

export const block = createBlock({
  id: "navbar",
  title: "Navbar",
  description: "The site's navigation",
  layoutOnly: true,
  content: (field) => ({ label: field.string({ default: "Home" }) }),
  toReact: () => <nav />,
  toTitle: ({ content }) => content.label,
  toMarkdown: ({ content }) => [content.label],
});
`,
  "src/layouts/default.tsx": `import { createLayout } from "camox/createLayout";

import { block as navbar } from "../blocks/navbar";

const layout = createLayout({
  id: "default",
  title: "Default",
  description: ${JSON.stringify(LAYOUT_DESCRIPTION)},
  blocks: { before: [navbar], after: [], initial: [() => import("../blocks/hero")] },
  toReact: ({ children }) => <main>{children}</main>,
  toTitle: ({ page }) => page.title,
  toDescription: ({ page }) => page.description,
});

export { layout };
`,
  "src/collections/authors.ts": `import { createCollection } from "camox/createCollection";

export const collection = createCollection({
  id: "authors",
  title: "Authors",
  description: "People who write",
  content: (field) => ({ name: field.string({ default: "" }), role: field.string({ default: "" }) }),
  toTitle: ({ content }) => content.name,
  toDescription: ({ content }) => content.role,
});
`,
};

let build: FixtureBuild;

before(async () => {
  // Reading the Definition Set never calls the API, and nothing here renders a page.
  build = await buildFixtureApp({ apiUrl: "http://127.0.0.1:9", files: FILES });
});

after(async () => {
  await build?.cleanup();
});

/** What dev mode's sync reads from the app's source, in a dev server over the same files. */
async function definitionSetInDevMode() {
  const server = await createServer({
    configFile: false,
    root: build.root,
    customLogger: createLogger("silent"),
    server: { middlewareMode: true },
    plugins: [
      // Dev mode's sync runs in Node, so it needs no Worker: only the name Camox checks for.
      { name: "vite-plugin-cloudflare" },
      camox({
        projectId: FIXTURE_PROJECT_ID,
        _internal: {
          apiUrl: "http://127.0.0.1:9",
          authenticationUrl: "http://127.0.0.1:9",
          localDeployToken: "local-deploy-token",
        },
      }),
    ],
  });
  try {
    return await loadDefinitionSet(server);
  } finally {
    await server.close();
  }
}

void test("the built server's Definition Set entrypoint returns the set dev mode's sync reads from the same source", async () => {
  const built = await build.readDefinitionSet();
  const dev = await definitionSetInDevMode();

  // What reaches the API is JSON, so that's what has to match.
  assert.deepEqual(built, JSON.parse(JSON.stringify(dev)));
  assert.deepEqual((built as typeof dev).blocks.map((block) => block.blockId).sort(), [
    "hero",
    "navbar",
  ]);
  assert.deepEqual(
    (built as typeof dev).collections.map((collection) => collection.collectionId),
    ["authors"],
  );
  assert.equal((built as typeof dev).homepage?.layoutId, "default");
});

void test("no HTTP request to the built Worker reaches its Definition Set", async () => {
  const worker = await build.serve();
  try {
    for (const path of [
      "/",
      "/camox",
      "/_camox/data?path=/",
      "/_camox/routes",
      "/_camox/definitions",
      "/_camox/definition-set",
      `/${DEFINITION_SET_ENTRYPOINT}`,
      "/llms.txt",
    ]) {
      const response = await worker.fetch(path);
      const body = await response.text();
      assert.ok(!body.includes(LAYOUT_DESCRIPTION), `${path} answers with the Definition Set`);
    }
  } finally {
    await worker.close();
  }
});
