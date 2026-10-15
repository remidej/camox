import assert from "node:assert/strict";
import { test } from "node:test";

import { collectBlockChunks } from "./blockChunks";

function chunk(
  fileName: string,
  options: { imports?: string[]; entry?: boolean; dynamic?: string } = {},
) {
  return {
    type: "chunk" as const,
    fileName,
    imports: options.imports ?? [],
    isEntry: options.entry ?? false,
    isDynamicEntry: options.dynamic !== undefined,
    facadeModuleId: options.dynamic ?? null,
  };
}

function bundle(...chunks: ReturnType<typeof chunk>[]) {
  return Object.fromEntries(chunks.map((c) => [c.fileName, c]));
}

void test("each block module maps to its chunk and the chunks it imports", () => {
  const blockChunks = collectBlockChunks(
    bundle(
      chunk("entry.mjs", { entry: true, imports: ["react.mjs"] }),
      chunk("react.mjs"),
      chunk("hero.mjs", { dynamic: "/app/src/blocks/hero.tsx", imports: ["shaders.mjs"] }),
      chunk("shaders.mjs", { imports: ["math.mjs"] }),
      chunk("math.mjs"),
      chunk("faq.mjs", { dynamic: "/app/src/camox/blocks/faq.tsx" }),
    ),
    "/app",
  );

  assert.deepEqual(blockChunks, {
    "/src/blocks/hero.tsx": ["hero.mjs", "shaders.mjs", "math.mjs"],
    "/src/camox/blocks/faq.tsx": ["faq.mjs"],
  });
});

void test("chunks the entries already load need no preload", () => {
  const blockChunks = collectBlockChunks(
    bundle(
      chunk("entry.mjs", { entry: true, imports: ["react.mjs"] }),
      chunk("react.mjs"),
      chunk("hero.mjs", { dynamic: "/app/src/blocks/hero.tsx", imports: ["react.mjs"] }),
    ),
    "/app",
  );

  assert.deepEqual(blockChunks, { "/src/blocks/hero.tsx": ["hero.mjs"] });
});

void test("other lazily loaded modules are not blocks", () => {
  const blockChunks = collectBlockChunks(
    bundle(
      chunk("editor.mjs", { dynamic: "/app/node_modules/camox/editor.mjs" }),
      chunk("nested.mjs", { dynamic: "/app/src/blocks/parts/nested.tsx" }),
    ),
    "/app",
  );

  assert.deepEqual(blockChunks, {});
});
