import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { plainTextToLexicalState } from "@/core/lib/lexicalState";

// The UI package's JSX uses the classic runtime when loaded directly by tsx.
Object.assign(globalThis, { React });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/queries") {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export const pageQueries = { getById: (id) => ({ queryKey: ["page", id] }) };
          export const blockQueries = { get: (id) => ({ queryKey: ["block", id] }) };
        `)}`,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/auth") {
      return {
        url: "data:text/javascript,export const useAuthContext = () => ({ authClient: { useSession: () => ({ data: null }) } })",
        shortCircuit: true,
      };
    }
    if (specifier === "@camox/ui/toaster") {
      return { url: "data:text/javascript,export const toast = () => {}", shortCircuit: true };
    }
    if (specifier === "@/lib/telemetry-client") {
      return {
        url: "data:text/javascript,export const trackClientEvent = () => {}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("Feedback lists every target level without a composer", async () => {
  const { CommentSidebar } = await import("./CommentSidebar");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: async () => null } } });
  client.setQueryData(["page", 3], { nickname: "Homepage" });
  client.setQueryData(["block", 7], {
    block: {
      summary: "Our latest work",
      content: { title: "Build something great", image: { _file: 9 } },
    },
    repeatableItems: [
      {
        id: 12,
        summary: "Featured project",
        content: { caption: plainTextToLexicalState("Thoughtfully designed") },
      },
    ],
  });
  const render = (children: React.ReactNode) =>
    renderToStaticMarkup(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  const empty = render(<CommentSidebar pageId={3} />);
  assert.match(empty, /<h2 class="text-base font-semibold">Feedback<\/h2>/);
  assert.match(empty, /aria-label="End comment mode"/);
  assert.match(empty, /No feedback yet/);

  const targets = [
    { label: "Page · 3" },
    { label: "Block · 7", blockId: 7 },
    { label: "Item · 12", blockId: 7, itemId: 12 },
    { label: "Field · title", blockId: 7, fieldName: "title", fieldType: "String" },
    { label: "Field · caption", blockId: 7, itemId: 12, fieldName: "caption", fieldType: "String" },
    { label: "Field · image", blockId: 7, fieldName: "image", fieldType: "Image" },
  ] as const;
  for (const [index, target] of targets.entries()) {
    previewCommentsStore.send({
      type: "startComment",
      pageId: 3,
      target: { ...target, selector: "body", x: 0.5, y: 0.5 },
    });
    previewCommentsStore.send({ type: "setMessage", message: `Feedback level ${index}` });
    previewCommentsStore.send({
      type: "postComment",
      id: String(index),
      author: { name: "Reviewer", image: null },
      createdAt: 1,
    });
  }
  const markup = render(<CommentSidebar pageId={3} />);
  for (const [index, target] of targets.entries()) {
    assert.match(markup, new RegExp(`Feedback level ${index}`));
    assert.ok(!markup.includes(target.label));
  }
  for (const quote of [
    "Homepage",
    "Our latest work",
    "Featured project",
    "Build something great",
    "Thoughtfully designed",
  ]) {
    assert.ok(markup.includes(quote));
  }
  assert.equal((markup.match(/<blockquote/g) ?? []).length, targets.length);
  assert.match(markup, /border-l-2 border-yellow-600/);
  assert.doesNotMatch(markup, /Comment text|Post comment|Comment on/);
  assert.doesNotMatch(markup, />View<\/button>|>Done<\/button>/);
  assert.equal((markup.match(/role="button"/g) ?? []).length, targets.length);
  assert.doesNotMatch(render(<CommentSidebar pageId={4} />), /Feedback level/);

  previewCommentsStore.send({
    type: "startComment",
    pageId: 3,
    target: { ...targets[4]!, selector: "body", x: 0.5, y: 0.5 },
  });
  previewCommentsStore.send({ type: "setMessage", message: "Draft feedback" });
  assert.doesNotMatch(render(<CommentSidebar pageId={3} />), /Draft feedback/);
  const { AttachedComments } = await import("./AttachedComments");
  const editor = renderToStaticMarkup(
    <AttachedComments pageId={3} blockId={7} itemId={12} fieldName="caption" />,
  );
  assert.match(editor, /Draft feedback/);
  assert.match(editor, /Comment text/);
  assert.match(editor, /Post comment/);
  assert.doesNotMatch(editor, />View<\/button>|>Done<\/button>/);
  assert.doesNotMatch(render(<CommentSidebar pageId={4} />), /Draft feedback/);
  client.clear();
  previewCommentsStore.send({ type: "clearSelection" });
});

void test("clicking or keyboard-activating a comment opens its editor without deleting it", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    __CAMOX_ENABLE_COMMENTS__: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { CommentSidebar } = await import("./CommentSidebar");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const { previewStore } = await import("../previewStore");
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: async () => null } } });
  client.setQueryData(["page", 88], { nickname: "Test page" });
  const target = { selector: "body", label: "Page", x: 0.5, y: 0.5 };
  for (const id of ["first-comment", "second-comment"]) {
    previewCommentsStore.send({ type: "startComment", pageId: 88, target });
    previewCommentsStore.send({ type: "setMessage", message: id });
    previewCommentsStore.send({
      type: "postComment",
      id,
      author: { name: "Reviewer", image: null },
      createdAt: 1,
    });
  }
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const comment = (index: number) => host.querySelectorAll('[role="button"]')[index]!;
  try {
    previewStore.send({ type: "enterEditMode" });
    previewStore.send({ type: "setCommentMode", enabled: true });
    await React.act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <CommentSidebar pageId={88} />
        </QueryClientProvider>,
      );
    });
    const commentsBefore = previewCommentsStore.getSnapshot().context.comments;
    await React.act(async () => comment(0).querySelector("p")!.click());
    assert.equal(previewStore.getSnapshot().context.mode, "editing-draft");
    assert.equal(previewStore.getSnapshot().context.selection, null);
    assert.equal(previewCommentsStore.getSnapshot().context.activeId, "first-comment");

    for (const key of ["Enter", " "]) {
      previewStore.send({ type: "setCommentMode", enabled: true });
      await React.act(async () => {
        comment(1).dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
      });
      assert.equal(previewStore.getSnapshot().context.mode, "editing-draft");
      assert.equal(previewStore.getSnapshot().context.selection, null);
      assert.equal(previewCommentsStore.getSnapshot().context.activeId, "second-comment");
    }
    assert.deepEqual(previewCommentsStore.getSnapshot().context.comments, commentsBefore);
  } finally {
    await React.act(async () => root.unmount());
    previewCommentsStore.send({ type: "clearSelection" });
    previewStore.send({ type: "exitEditMode" });
    client.clear();
    await window.happyDOM.close();
  }
});
