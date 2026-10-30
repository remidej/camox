import assert from "node:assert/strict";
import { test } from "node:test";

import type { FindingView } from "@camox/api-contract/patrol";

import { askAgentMessage } from "./findingSentence";

const finding = (overrides: Partial<FindingView> = {}): FindingView => ({
  id: 1,
  about: { kind: "missingPage", url: "camox:page:page-2", text: "About us", page: "About" },
  fix: { kind: "removeLink" },
  subject: { entity: "block", id: "block-1", name: "Footer" },
  locale: "fr",
  field: "body",
  raisedAt: 0,
  live: false,
  place: null,
  ...overrides,
});

void test("asking the agent about a finding tells it what it is, where, and its suggested fix", () => {
  assert.equal(
    askAgentMessage(finding(), "Link checker"),
    "Link checker finding: “About us” in Footer links to About, a page that no longer exists " +
      "(in French, field “body”). Suggested fix: Remove the link.",
  );
});

void test("asking the agent about a finding without a fix suggests none", () => {
  assert.equal(
    askAgentMessage(finding({ fix: null, locale: "en" }), "Link checker"),
    "Link checker finding: “About us” in Footer links to About, a page that no longer exists " +
      "(in English, field “body”).",
  );
});
