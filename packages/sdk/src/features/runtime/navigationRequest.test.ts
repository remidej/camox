import assert from "node:assert/strict";
import { test } from "node:test";

import { createNavigationRequestTracker } from "./navigationRequest";

void test("superseded responses cannot commit even if fetch ignores abort", async () => {
  const requests = createNavigationRequestTracker();
  const first = requests.begin();
  const second = requests.begin();
  const commits: string[] = [];
  await Promise.resolve();
  if (second.isCurrent()) commits.push("second");
  if (first.isCurrent()) commits.push("first");
  assert.deepEqual(commits, ["second"]);
  assert.equal(first.signal.aborted, true);
});

void test("unmount and external navigation invalidate pending commits and fallbacks", () => {
  const requests = createNavigationRequestTracker();
  const first = requests.begin();
  requests.cancel();
  assert.equal(first.isCurrent(), false);
  const second = requests.begin();
  assert.equal(second.isCurrent(), true);
});
