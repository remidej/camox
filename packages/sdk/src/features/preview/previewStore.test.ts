import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import type { PreviewMode } from "./previewStore";

// Test real store transitions without browser-only notifications or telemetry.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@camox/ui/toaster") {
      return { url: "data:text/javascript,export const toast = () => {}", shortCircuit: true };
    }
    if (specifier === "@/lib/telemetry-client") {
      return {
        url: "data:text/javascript,export const trackClientEvent = () => {}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("preview modes have only valid edit/source combinations across every transition", async () => {
  const { previewStore, selectIsEditMode, selectPreviewSource } = await import("./previewStore");
  const modes: PreviewMode[] = ["editing-draft", "previewing-draft", "previewing-live"];
  const transitions = [
    { type: "enterEditMode", expected: ["editing-draft", "editing-draft", "editing-draft"] },
    { type: "exitEditMode", expected: ["previewing-draft", "previewing-draft", "previewing-live"] },
    { type: "viewLivePage", expected: ["previewing-live", "previewing-live", "previewing-live"] },
    { type: "viewDraftPage", expected: ["editing-draft", "previewing-draft", "previewing-draft"] },
  ] as const;

  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");

  for (const [index, mode] of modes.entries()) {
    for (const { type, expected } of transitions) {
      previewStore.send({ type: "enterEditMode" });
      if (mode === "previewing-draft") previewStore.send({ type: "exitEditMode" });
      if (mode === "previewing-live") previewStore.send({ type: "viewLivePage" });

      previewStore.send({ type });
      const snapshot = previewStore.getSnapshot();
      assert.equal(snapshot.context.mode, expected[index], `${mode} → ${type}`);
      assert.equal(selectIsEditMode(snapshot), snapshot.context.mode === "editing-draft");
      assert.equal(
        selectPreviewSource(snapshot),
        snapshot.context.mode === "previewing-live" ? "live" : "draft",
      );
      assert.equal(selectIsEditMode(snapshot) && selectPreviewSource(snapshot) === "live", false);
      if (type === "viewLivePage") assert.equal(snapshot.context.isToolbarHidden, true);
      if (type === "enterEditMode" || type === "viewDraftPage") {
        assert.equal(snapshot.context.isToolbarHidden, false);
      }
    }
  }
});
