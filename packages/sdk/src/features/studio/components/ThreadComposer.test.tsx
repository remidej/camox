import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { ThreadComposer } = await import("./ThreadComposer");

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
