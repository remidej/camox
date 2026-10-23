import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPlatform } from "@tanstack/react-hotkeys";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

const PAGE_URL = "https://site.test/about?ref=nav";
const AUTHENTICATION_URL = "https://auth.test";

const window = new Window({
  url: PAGE_URL,
  settings: { navigation: { disableMainFrameNavigation: true } },
});
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { AuthContext } = await import("../../lib/auth");
const { takeShowCanvasRequest, useSignInShortcut } = await import("./signInShortcut");

function ShortcutHost() {
  useSignInShortcut(true);
  return <textarea />;
}

async function renderShortcut() {
  window.location.href = PAGE_URL;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AuthContext.Provider
        value={{ authenticationUrl: AUTHENTICATION_URL } as React.ContextType<typeof AuthContext>}
      >
        <ShortcutHost />
      </AuthContext.Provider>,
    ),
  );
  return {
    textarea: container.querySelector("textarea")!,
    unmount: () => act(async () => root.unmount()),
  };
}

function pressToggleCanvas(target: EventTarget = document.body) {
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      // Mod is Command where happy-dom reports macOS, Control elsewhere.
      ...(detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true }),
      bubbles: true,
    }) as unknown as Event,
  );
}

void test("signed out, the show-canvas shortcut signs in and comes back to show the Canvas", async () => {
  const { unmount } = await renderShortcut();
  pressToggleCanvas();

  const signIn = new URL(window.location.href);
  assert.equal(`${signIn.origin}${signIn.pathname}`, `${AUTHENTICATION_URL}/studio-authorize`);
  const callback = signIn.searchParams.get("callback")!;
  assert.notEqual(callback, PAGE_URL);

  // Back from signing in, on the page the shortcut was pressed on.
  window.location.href = callback;
  assert.equal(takeShowCanvasRequest(), true);
  assert.equal(window.location.href, PAGE_URL);
  assert.equal(takeShowCanvasRequest(), false);
  await unmount();
});

void test("the shortcut stays with fields, which sites often submit with it", async () => {
  const { textarea, unmount } = await renderShortcut();
  textarea.focus();
  pressToggleCanvas(textarea);

  assert.equal(window.location.href, PAGE_URL);
  await unmount();
});

void test("pages a sign-in from the shortcut didn't lead to don't show the Canvas", () => {
  window.location.href = PAGE_URL;
  assert.equal(takeShowCanvasRequest(), false);
  assert.equal(window.location.href, PAGE_URL);
});
