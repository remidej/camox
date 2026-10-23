import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFixtureApp } from "./fixtureApp";

// Building makes no request: nothing has to listen here.
const API_URL = "http://127.0.0.1:9";

/** The fixture's hero block, with `imports` added at its top. */
function heroImporting(imports: string, { id = '"hero"' } = {}) {
  return `${imports}
import { createBlock } from "camox/createBlock";

export const block = createBlock({
  id: ${id},
  title: "Hero",
  description: "A title",
  content: (field) => ({ title: field.string({ default: "Welcome" }) }),
  toReact: () => <block.Field name="title">{(props) => <h1 {...props} />}</block.Field>,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [content.title],
});
`;
}

/** Builds the fixture app with `files` and the hosted checks on, and returns the build's error. */
async function hostedBuildError(files: Record<string, string>): Promise<Error> {
  let build: Awaited<ReturnType<typeof buildFixtureApp>> | undefined;
  try {
    build = await buildFixtureApp({ apiUrl: API_URL, files, hosted: true });
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  await build.cleanup();
  assert.fail("The hosted build succeeded");
}

void test("a hosted build of code inside the line succeeds", async () => {
  const build = await buildFixtureApp({
    apiUrl: API_URL,
    hosted: true,
    files: {
      "src/blocks/hero.tsx": heroImporting(
        [
          `import { useState } from "react";`,
          `import { createRoot } from "react-dom/client";`,
          `import { useNavigate } from "camox/navigation";`,
          `import { title } from "./shared/title";`,
          `import fontUrl from "/src/fonts/fixture.woff2?url";`,
          `void [useState, createRoot, useNavigate, title, fontUrl, import("./shared/title")];`,
        ].join("\n"),
      ),
      "src/blocks/shared/title.ts": `export const title = "Hello";\n`,
    },
  });
  await build.cleanup();
});

const FORBIDDEN_IMPORTS = [
  { name: "a Node.js built-in", specifier: "node:fs" },
  { name: "a Cloudflare runtime module", specifier: "cloudflare:workers" },
  { name: "a devDependency", specifier: "@cloudflare/vite-plugin" },
  { name: "a private camox path", specifier: "camox/_internal/runtime" },
  { name: "a path leaving src/", specifier: "../../outside" },
];

for (const { name, specifier } of FORBIDDEN_IMPORTS) {
  void test(`a hosted build fails on an import of ${name}, naming the file and the import`, async () => {
    const error = await hostedBuildError({
      "src/blocks/hero.tsx": heroImporting(
        `import * as forbidden from "${specifier}";\nvoid forbidden;`,
      ),
      "outside.ts": "export const outside = true;\n",
    });
    // Not any failure: some of these fail on their own, in the browser's build.
    assert.ok(error.message.includes(`src/blocks/hero.tsx imports "${specifier}"`), error.message);
  });
}

void test("a hosted build fails on a block whose file name isn't its id, naming the file and both names", async () => {
  const error = await hostedBuildError({
    "src/blocks/hero.tsx": heroImporting("", { id: '"hero-banner"' }),
  });
  assert.match(error.message, /src\/blocks\/hero\.tsx/);
  assert.match(error.message, /"hero-banner"/);
  assert.match(error.message, /"hero"/);
});

void test("a hosted build fails on a block whose id it can't read", async () => {
  const error = await hostedBuildError({
    "src/blocks/hero.tsx": heroImporting(`const id = "hero";`, { id: "id" }),
  });
  assert.match(error.message, /src\/blocks\/hero\.tsx/);
  assert.match(error.message, /string literal/);
});

void test("without the hosted flag, the same app builds", async () => {
  const build = await buildFixtureApp({
    apiUrl: API_URL,
    files: {
      "src/blocks/hero.tsx": heroImporting(
        [
          `import { matchRuntimeRoute } from "camox/_internal/runtime";`,
          `import { outside } from "../../outside";`,
          `void [matchRuntimeRoute, outside];`,
        ].join("\n"),
        { id: '"hero-banner"' },
      ),
      "outside.ts": "export const outside = true;\n",
    },
  });
  await build.cleanup();
});
