import assert from "node:assert/strict";
import { test } from "node:test";

import type { ThreadView } from "@camox/api-contract/threads";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { ThreadMessages } = await import("./ThreadMessages");

const editor = { id: "user-1", name: "Ada Lovelace", image: null };

void test("a thread shows editors' messages, the agent's Markdown answers and its work", () => {
  const view: ThreadView = {
    working: true,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Which pages mention <pricing>?" },
      {
        id: "2",
        from: "agent",
        text: "Two pages do:\n\n- **Home**\n- [Plans](https://example.com/plans)\n\n<script>alert(1)</script>",
      },
      { id: "3", from: "editor", sender: editor, text: "Rewrite them" },
    ],
  };

  const html = renderToString(<ThreadMessages view={view} />);

  // Editors' messages are text, with their sender's avatar.
  assert.match(html, /Which pages mention &lt;pricing&gt;\?/);
  assert.match(html, /Rewrite them/);
  assert.equal(html.match(/>AL</g)?.length, 2);
  // The agent's answer is Markdown, never raw HTML, beside the Camox logo.
  assert.match(html, /<strong[^>]*>Home<\/strong>/);
  assert.match(html, /<li[^>]*>.*Home/);
  assert.match(html, /<a [^>]*href="https:\/\/example.com\/plans"[^>]*>Plans<\/a>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /aria-label="Camox"/);
  assert.match(html, /Working…/);
});

void test("an empty thread says what the agent can do, in one line", () => {
  const html = renderToString(<ThreadMessages view={{ messages: [], working: false }} />);

  assert.match(html, /data-thread-empty/);
  assert.doesNotMatch(html, /Working…/);
});
