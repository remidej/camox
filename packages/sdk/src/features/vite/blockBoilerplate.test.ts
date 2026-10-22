import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ViteDevServer } from "vite-plus";

import { watchNewBlockFiles } from "./blockBoilerplate";

void test("a new empty block file is filled with a block written with the to* options", (t) => {
  const root = mkdtempSync(join(tmpdir(), "camox-block-boilerplate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src/blocks"), { recursive: true });
  const watcher = new EventEmitter();
  const logger = { info: () => {}, error: () => {} };
  watchNewBlockFiles({ config: { root, logger }, watcher } as unknown as ViteDevServer);

  const path = join(root, "src/blocks/pricing-table.tsx");
  writeFileSync(path, "");
  watcher.emit("add", path);
  const block = readFileSync(path, "utf8");

  assert.match(block, /\btoReact: PricingTableComponent,/);
  assert.match(block, /\btoMarkdown: \(\{ content \}\) => \[content\.title\]/);
  assert.match(block, /\btoTitle: \(\{ content \}\) => content\.title,/);
  assert.doesNotMatch(block, /\bcomponent:/);
});
