import assert from "node:assert/strict";
import { test } from "node:test";

import { validatePreviewTarget } from "./preview-handoff";

const target = {
  projectSlug: "site",
  environmentName: "dev:me@example.test",
  apiUrl: "https://api.example.test",
};

void test("ordinary sign-in and matching preview destinations are accepted", () => {
  assert.equal(validatePreviewTarget(null, target), null);
  assert.equal(validatePreviewTarget(JSON.stringify(target), target), null);
  assert.equal(
    validatePreviewTarget(JSON.stringify({ ...target, apiUrl: `${target.apiUrl}/` }), target),
    null,
  );
});

void test("mismatched project, environment, and backend fail closed before token exchange", () => {
  for (const expected of [
    { ...target, projectSlug: "other" },
    { ...target, environmentName: "production" },
    { ...target, environmentName: "dev:someone-else@example.test" },
    { ...target, apiUrl: "https://other.example.test" },
    {},
    null,
  ]) {
    assert.match(validatePreviewTarget(JSON.stringify(expected), target) ?? "", /does not match/);
  }
  assert.match(validatePreviewTarget("not json", target) ?? "", /does not match/);
});
