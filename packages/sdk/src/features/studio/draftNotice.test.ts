import assert from "node:assert/strict";
import { test } from "node:test";

import { draftNoticeMessage } from "./draftNotice";

void test("the notice for an ended draft says whether it was published or deleted, and by whom", () => {
  const endedBy = { id: "user-2", name: "Ada" };
  assert.equal(
    draftNoticeMessage({
      reason: "ended",
      draftId: "d1",
      outcome: "published",
      endedBy,
      endedAt: 1,
    }),
    "Ada published this draft, so you're viewing Live.",
  );
  assert.equal(
    draftNoticeMessage({
      reason: "ended",
      draftId: "d1",
      outcome: "deleted",
      endedBy,
      endedAt: 1,
    }),
    "Ada deleted this draft, so you're viewing Live.",
  );
});
