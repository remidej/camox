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
    running: true,
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
  // The agent's answer is Markdown, never raw HTML, with no avatar: the sidebar is narrow.
  assert.match(html, /<strong[^>]*>Home<\/strong>/);
  assert.match(html, /<li[^>]*>.*Home/);
  assert.match(html, /<a [^>]*href="https:\/\/example.com\/plans"[^>]*>Plans<\/a>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /aria-label="Camox"/);
  assert.match(html, /Working…/);
});

void test("a draft's thread names who sent each message; a Live thread doesn't", () => {
  const teammate = { id: "user-2", name: "Grace Hopper", image: null };
  const view: ThreadView = {
    running: false,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Rewrite the intro" },
      { id: "2", from: "agent", text: "Done." },
      { id: "3", from: "editor", sender: teammate, text: "And the outro" },
    ],
  };

  const inDraft = renderToString(<ThreadMessages view={view} showSenders />);
  const onLive = renderToString(<ThreadMessages view={view} />);

  assert.match(inDraft, />Ada Lovelace</);
  assert.match(inDraft, />Grace Hopper</);
  assert.doesNotMatch(onLive, />Ada Lovelace</);
});

void test("a turn without the agent's message says it was stopped, and by whom, or couldn't finish", () => {
  const view: ThreadView = {
    running: false,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Rewrite every page" },
      { id: "2", from: "stopped", sender: { id: "user-2", name: "Grace Hopper", image: null } },
      { id: "3", from: "editor", sender: editor, text: "Rewrite the home page" },
      { id: "4", from: "failed" },
    ],
  };

  const html = renderToString(<ThreadMessages view={view} />);

  assert.match(html, /Stopped by Grace Hopper/);
  assert.match(html, /Camox couldn’t finish this\. Send your message again to retry\./);
  assert.doesNotMatch(html, /Working…/);
});

void test("an empty thread says what the agent can do, in one line", () => {
  const html = renderToString(<ThreadMessages view={{ messages: [], running: false }} />);

  assert.match(html, /data-thread-empty/);
  assert.doesNotMatch(html, /Working…/);
});

void test("a fresh Live thread links to the draft the editor's previous one continued in", () => {
  const continuedIn = { label: "Ada Lovelace, Oct 20", href: "/pricing?camox-draft=d1" };

  const empty = renderToString(
    <ThreadMessages view={{ messages: [], running: false }} continuedIn={continuedIn} />,
  );
  const answered = renderToString(
    <ThreadMessages
      view={{
        running: false,
        messages: [
          { id: "1", from: "editor", sender: editor, text: "What do plans cost?" },
          { id: "2", from: "agent", text: "Plans start at $9." },
        ],
      }}
      continuedIn={continuedIn}
    />,
  );

  for (const html of [empty, answered]) {
    assert.match(
      html,
      /Continued in(<!-- -->)? <a [^>]*href="\/pricing\?camox-draft=d1"[^>]*>Ada Lovelace, Oct 20<\/a>/,
    );
  }
});

void test("a message still on its way to the thread shows the agent working before its run starts", () => {
  const html = renderToString(<ThreadMessages view={{ messages: [], running: false }} sending />);

  assert.doesNotMatch(html, /data-thread-empty/);
  assert.match(html, /Working…/);
});
