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

void test("the squareling stays at the end of the thread, idle, after a turn", () => {
  const html = renderToString(
    <ThreadMessages
      view={{
        running: false,
        messages: [
          { id: "1", from: "editor", sender: editor, text: "What do plans cost?" },
          { id: "2", from: "agent", text: "Plans start at $9." },
        ],
      }}
    />,
  );

  assert.match(html, /Plans start at \$9\.[\s\S]*data-squareling="idle"/);
  assert.doesNotMatch(html, /Working…/);
});

void test("an empty thread has the agent's squareling ask how it can help", () => {
  const html = renderToString(<ThreadMessages view={{ messages: [], running: false }} />);

  assert.match(html, /data-thread-empty/);
  assert.match(html, /How can I help\?/);
  assert.doesNotMatch(html, /Working…/);
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
      /** Everything the status says, screen-reader text included. */
      said: working.textContent,
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
  // Building and fixing say so instead of working, even to a screen reader.
  assert.match(shown().said, /Working…/);
  assert.doesNotMatch(shown("building").said, /Working…/);
  assert.doesNotMatch(shown("fixing").said, /Working…/);
});

/**
 * Renders `view` in a happy-dom document, clicks the draft's card, then unmounts: what the card
 * says, what the whole thread says, and the drafts the click opened.
 */
async function clickingTheCard(view: ThreadView) {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    matchMedia: window.matchMedia.bind(window),
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
    const opened: string[] = [];
    const root = createRoot(container as unknown as Element);
    await act(async () =>
      root.render(<ThreadMessages view={view} onOpenDraft={(id) => opened.push(id)} />),
    );

    const card = container.querySelector("[data-thread-draft-card]")!;
    const shown = { card: card.textContent, thread: container.textContent };
    await act(async () => (card as unknown as HTMLElement).click());
    await act(async () => root.unmount());
    return { ...shown, opened };
  } finally {
    Object.assign(globalThis, before);
  }
}

void test("a Live turn handed off to a draft ends on the draft's card, which opens it", async () => {
  const { card, thread, opened } = await clickingTheCard({
    running: false,
    messages: [
      { id: "1", from: "editor", sender: editor, text: "Raise the price" },
      { id: "2", from: "draft", draftId: "draft-1", name: "New prices" },
    ],
  });

  assert.match(card, /New prices/);
  // The handoff answers the turn: nothing says Camox couldn't finish it.
  assert.doesNotMatch(thread, /couldn’t finish/);
  assert.deepEqual(opened, ["draft-1"]);
});

for (const [ended, said] of [
  ["published", /Published/],
  ["deleted", /Deleted/],
] as const) {
  void test(`the card of a draft ${ended} says so with its last name, and opens nothing`, async () => {
    const { card, opened } = await clickingTheCard({
      running: false,
      messages: [
        { id: "1", from: "editor", sender: editor, text: "Raise the price" },
        { id: "2", from: "draft", draftId: "draft-1", name: "Prices for 2027", ended },
      ],
    });

    assert.match(card, /Prices for 2027/);
    assert.match(card, said);
    assert.deepEqual(opened, []);
  });
}
