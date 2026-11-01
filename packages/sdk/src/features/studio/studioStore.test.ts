import assert from "node:assert/strict";
import { test } from "node:test";

import { studioStore } from "./studioStore";

const context = () => studioStore.getSnapshot().context;

void test("asking the agent leaves the review for the chat, and asking the same again fills it again", () => {
  studioStore.trigger.openReviewDraftSheet({});
  studioStore.trigger.askAgent({ text: "Fix the footer's link" });
  const first = context().agentAsk;
  studioStore.trigger.takeAgentAsk();
  studioStore.trigger.askAgent({ text: "Fix the footer's link" });

  assert.equal(context().isReviewDraftSheetOpen, false);
  assert.equal(context().agentAsk?.text, "Fix the footer's link");
  assert.notEqual(context().agentAsk?.id, first?.id);
});
