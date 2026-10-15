import assert from "node:assert/strict";
import { test } from "node:test";

import { draftLabel, isSettledIn } from "./commentStatus";

const addressedIn = {
  draftId: "0190a000-0000-7000-8000-000000000001",
  name: null,
  createdBy: { name: "Rémi" },
  createdAt: Date.UTC(2026, 9, 13, 12),
};

void test("a Live comment resolved from a draft is settled in that draft only", () => {
  const comment = { resolved: false, addressedIn };

  assert.equal(isSettledIn(comment, addressedIn.draftId), true);
  assert.equal(isSettledIn(comment, null), false, "Live still shows it, marked as addressed");
  assert.equal(isSettledIn(comment, "0190a000-0000-7000-8000-000000000002"), false);
});

void test("a resolved comment is settled everywhere", () => {
  assert.equal(isSettledIn({ resolved: true, addressedIn: null }, null), true);
});

void test("a draft reads as its name, or its creator and creation date", () => {
  assert.equal(draftLabel({ ...addressedIn, name: "Copy fixes" }), "Copy fixes");
  assert.match(draftLabel(addressedIn), /^Rémi, .*13/);
});
