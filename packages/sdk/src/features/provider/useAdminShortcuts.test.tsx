import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPlatform, type HotkeyChord } from "@tanstack/react-hotkeys";
import { Window } from "happy-dom";
import type * as React from "react";
import { act } from "react";

const window = new Window({ url: "https://site.test/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  KeyboardEvent: window.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { actionsStore } = await import("./actionsStore");
const { useActionShortcuts, useAdminShortcuts } = await import("./useAdminShortcuts");

// Mod is Command where happy-dom reports macOS, Control elsewhere.
const MOD_KEY = detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true };

function Shortcuts() {
  useAdminShortcuts();
  return null;
}

function FrameShortcuts({ frameWindow }: { frameWindow: typeof globalThis.window }) {
  useActionShortcuts(frameWindow);
  return null;
}

async function setup(
  actions: { shortcut: HotkeyChord; available?: () => boolean }[],
  shortcuts: React.ReactNode = <Shortcuts />,
) {
  const runs: string[] = [];
  const registered = actions.map(({ shortcut, available = () => true }, index) => ({
    id: `action-${index}`,
    label: `Action ${index}`,
    groupLabel: "Studio" as const,
    shortcut,
    checkIfAvailable: available,
    execute: () => runs.push(`action-${index}`),
  }));
  actionsStore.send({ type: "registerManyActions", actions: registered });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(shortcuts));
  return {
    runs,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      actionsStore.send({ type: "unregisterManyActions", ids: registered.map(({ id }) => id) });
    },
  };
}

function field(tag: "input" | "textarea" = "input") {
  const element = document.createElement(tag);
  document.body.append(element);
  element.focus();
  return element;
}

function press(
  target: EventTarget,
  init: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
) {
  const event = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event as unknown as Event);
  return event;
}

void test("a shortcut runs the first of its actions that is available", async () => {
  const { runs, cleanup } = await setup([
    { shortcut: "Mod+Enter", available: () => false },
    { shortcut: "Mod+Enter" },
    { shortcut: "Mod+Enter" },
  ]);
  const event = press(document.body, { key: "Enter", ...MOD_KEY });
  assert.deepEqual(runs, ["action-1"]);
  assert.equal(event.defaultPrevented, true);
  await cleanup();
});

void test("a shortcut no available action claims stays with the page", async () => {
  const { runs, cleanup } = await setup([{ shortcut: "Mod+D", available: () => false }]);
  const event = press(document.body, { key: "d", ...MOD_KEY });
  assert.deepEqual(runs, []);
  assert.equal(event.defaultPrevented, false);
  await cleanup();
});

void test("fields keep plain keys and Mod+Backspace, but not other modified shortcuts", async () => {
  const { runs, cleanup } = await setup([
    { shortcut: "M" },
    { shortcut: "Mod+Backspace" },
    { shortcut: "Alt+ArrowUp" },
    { shortcut: "Mod+K" },
  ]);
  const input = field();
  press(input, { key: "m" });
  press(input, { key: "Backspace", ...MOD_KEY });
  assert.deepEqual(runs, []);
  press(input, { key: "ArrowUp", altKey: true });
  press(input, { key: "k", ...MOD_KEY });
  assert.deepEqual(runs, ["action-2", "action-3"]);
  input.remove();
  await cleanup();
});

void test("Escape leaves a field and runs, unless something handled it first", async () => {
  const { runs, cleanup } = await setup([{ shortcut: "Escape" }]);
  const textarea = field("textarea");
  press(textarea, { key: "Escape" });
  assert.deepEqual(runs, ["action-0"]);
  assert.notEqual(document.activeElement, textarea);

  const dialog = document.createElement("div");
  document.body.append(dialog);
  dialog.addEventListener("keydown", (event) => event.preventDefault());
  press(dialog, { key: "Escape" });
  assert.deepEqual(runs, ["action-0"]);
  textarea.remove();
  dialog.remove();
  await cleanup();
});

void test("shortcuts pressed in a preview iframe run the Studio's actions", async () => {
  // Stands in for the iframe's window: another window, with its own document and focus.
  const frame = new Window({ url: "https://site.test/" });
  const frameWindow = frame as unknown as typeof globalThis.window;
  const frameDocument = frameWindow.document;
  const { runs, cleanup } = await setup(
    [{ shortcut: "O" }, { shortcut: "Escape" }],
    <FrameShortcuts frameWindow={frameWindow} />,
  );
  press(frameDocument.body, { key: "o" });
  assert.deepEqual(runs, ["action-0"]);

  const input = frameDocument.createElement("input");
  frameDocument.body.append(input);
  input.focus();
  press(input, { key: "o" });
  assert.deepEqual(runs, ["action-0"]);
  press(input, { key: "Escape" });
  assert.deepEqual(runs, ["action-0", "action-1"]);
  assert.notEqual(frameDocument.activeElement, input);
  await cleanup();
  await frame.happyDOM.close();
});
