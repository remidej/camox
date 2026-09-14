import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToString } from "react-dom/server";

import { PreviewActivation, PreviewActivationContext } from "./PreviewActivation";

void test("SSR preview stays visible even when the editor module has already resolved", () => {
  function Editor() {
    assert.equal(typeof React.useContext(PreviewActivationContext), "function");
    return <div data-editor />;
  }

  const html = renderToString(
    <PreviewActivation fallback={<div data-server-preview />}>
      <Editor />
    </PreviewActivation>,
  );

  // Resolving the editor import alone is not enough: its iframe still needs to
  // load its document/styles and commit the portal before replacing the SSR view.
  assert.match(html, /style="visibility:hidden"[^>]*>.*data-editor/);
  assert.match(html, /class="absolute inset-0"><div data-server-preview/);
});

void test("SSR preview stays outside the editor's Suspense boundary", () => {
  const Editor = React.lazy(() => new Promise<{ default: () => React.ReactNode }>(() => {}));
  const html = renderToString(
    <PreviewActivation fallback={<div data-server-preview />}>
      <Editor />
    </PreviewActivation>,
  );

  assert.match(html, /<!--\/\$--><\/div><div class="absolute inset-0"><div data-server-preview/);
  assert.equal(html.match(/data-server-preview/g)?.length, 1);
});
