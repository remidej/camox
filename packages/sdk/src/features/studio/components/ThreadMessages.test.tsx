import assert from "node:assert/strict";
import { test } from "node:test";

import type { ThreadView } from "@camox/api-contract/threads";
import { Window } from "happy-dom";
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

void test("a turn Camox started itself opens with its message, from no editor", () => {
  const view: ThreadView = {
    running: true,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Add a pricing section" },
      { id: "2", from: "agent", text: "Done." },
      { id: "3", from: "camox", text: "Live's code changed, and I'm reconciling it." },
    ],
  };

  const html = renderToString(<ThreadMessages view={view} />);

  assert.match(html, /Live&#x27;s code changed, and I&#x27;m reconciling it\./);
  assert.match(html, />Camox</);
  // Only the editor's message has an avatar.
  assert.equal(html.match(/>AL</g)?.length, 1);
});

void test("a thread shows who sent each message by their avatar, without their name", () => {
  const teammate = { id: "user-2", name: "Grace Hopper", image: null };
  const view: ThreadView = {
    running: false,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Rewrite the intro" },
      { id: "2", from: "agent", text: "Done." },
      { id: "3", from: "editor", sender: teammate, text: "And the outro" },
    ],
  };

  const html = renderToString(<ThreadMessages view={view} />);

  assert.match(html, />AL</);
  assert.match(html, />GH</);
  assert.doesNotMatch(html, /Ada Lovelace/);
  assert.doesNotMatch(html, /Grace Hopper/);
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

void test("a message sent while the agent works is appended last, so the scroller brings it into view", () => {
  // The scroller anchors an editor's message near the top only when it's appended after every
  // row it already had: nothing else may follow the messages, not even the agent's work.
  const view: ThreadView = {
    running: true,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Rewrite the intro" },
      { id: "2", from: "editor", sender: editor, text: "And the outro" },
    ],
  };
  const { document } = new Window();
  document.body.innerHTML = renderToString(<ThreadMessages view={view} />);

  const content = document.querySelector('[data-slot="message-scroller-content"]')!;
  const rows = [...content.children].filter((row) => !row.hasAttribute("hidden"));
  assert.deepEqual(
    rows.map((row) => row.getAttribute("data-message-id")),
    ["1", "2"],
  );
  assert.match(rows.at(-1)!.textContent, /Working…/);
});

void test("a thread says the agent's code is building, then that it fixes a build error, instead of working", () => {
  const asked = { id: "1", from: "editor" as const, sender: editor, text: "Add a pricing section" };
  const shown = (status?: ThreadView["status"]) =>
    renderToString(<ThreadMessages view={{ running: true, messages: [asked], status }} />);

  assert.match(shown("building"), /Building…/);
  assert.doesNotMatch(shown("building"), /Working…/);
  assert.match(shown("fixing"), /Fixing a build error…/);
  assert.doesNotMatch(shown("fixing"), /Working…/);
  assert.match(shown(), /Working…/);
});

void test("the agent's squareling thinks, acts while it uses its tools or builds, and fixes; only building and fixing say it in words", () => {
  const asked = { id: "1", from: "editor" as const, sender: editor, text: "Add a pricing section" };
  const { document } = new Window();
  const shown = (status?: ThreadView["status"], usingTools?: true) => {
    document.body.innerHTML = renderToString(
      <ThreadMessages view={{ running: true, messages: [asked], status, usingTools }} />,
    );
    const working = document.querySelector('[role="status"]')!;
    return {
      squareling: working.querySelector("[data-squareling]")?.getAttribute("data-squareling"),
      visibleText: [...working.children]
        .filter((child) => child.tagName !== "svg" && !child.classList.contains("sr-only"))
        .map((child) => child.textContent)
        .join(""),
    };
  };

  assert.equal(shown().squareling, "thinking");
  assert.equal(shown().visibleText, "");
  assert.equal(shown(undefined, true).squareling, "acting");
  assert.equal(shown(undefined, true).visibleText, "");
  assert.equal(shown("building").squareling, "acting");
  assert.equal(shown("building").visibleText, "Building…");
  assert.equal(shown("fixing").squareling, "fixing");
  assert.equal(shown("fixing", true).squareling, "fixing");
  assert.equal(shown("fixing").visibleText, "Fixing a build error…");
});
