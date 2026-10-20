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
