import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { ThreadComposer, useComposerCarrier } = await import("./ThreadComposer");

const noop = () => {};

void test("while a run is going, a Stop button sits beside Send", () => {
  const html = renderToString(<ThreadComposer onSend={noop} onStop={noop} running />);

  assert.match(html, />Stop<\/span>.*>Send<\/span>/s);
});

void test("with no run going, there's no Stop button", () => {
  const html = renderToString(<ThreadComposer onSend={noop} onStop={noop} running={false} />);

  assert.doesNotMatch(html, />Stop</);
  assert.match(html, />Send</);
});

void test("the selection shows over the message, with a button that clears it", () => {
  const html = renderToString(
    <ThreadComposer onSend={noop} selection="Title" onClearSelection={noop} />,
  );

  assert.match(html, /aria-label="Selection".*Title.*>Clear selection<\/span>.*<textarea/s);
});

void test("with nothing selected, there's no selection over the message", () => {
  const html = renderToString(<ThreadComposer onSend={noop} onClearSelection={noop} />);

  assert.doesNotMatch(html, /Selection|Clear selection/);
});

void test("a message filled in from elsewhere in the studio waits in the message box, unsent", () => {
  const html = renderToString(
    <ThreadComposer onSend={noop} filled={{ text: "Fix the footer's link", id: 1 }} />,
  );

  assert.match(html, /<textarea[^>]*>Fix the footer&#x27;s link<\/textarea>/);
});

void test("the next thread's composer goes on where the editor was: with what they wrote, focused if it was", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const before = Object.fromEntries(
    Object.keys(globals).map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, globals);
  try {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    // Like the Chat widget, which keeps the carrier as each thread's composer comes and goes.
    function Chat({ thread, focused }: { thread: string; focused: boolean }) {
      const carry = useComposerCarrier();
      return (
        <ThreadComposer
          key={thread}
          onSend={noop}
          carry={carry}
          // A filled message focuses the box; one left alone stays blurred.
          filled={focused ? { text: "And the outro", id: 1 } : undefined}
        />
      );
    }
    const composer = (thread: string, focused: boolean) =>
      act(async () => root.render(<Chat thread={thread} focused={focused} />));
    const box = () => window.document.querySelector("textarea")!;

    await composer("live", true);
    await composer("draft", false);
    assert.equal(box().value, "And the outro");
    assert.equal(window.document.activeElement, box());

    box().blur();
    await composer("another draft", false);
    assert.equal(box().value, "And the outro");
    assert.notEqual(window.document.activeElement, box());

    await act(async () => root.unmount());
  } finally {
    Object.assign(globalThis, before);
  }
});
