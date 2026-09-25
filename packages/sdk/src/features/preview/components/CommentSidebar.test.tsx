import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import type { Comment, CommentTarget } from "@camox/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { plainTextToLexicalState } from "@/core/lib/lexicalState";

type CreateInput = { id: string; pageId: number; message: string; target: CommentTarget };
const api = {
  list: async (_pageId: number): Promise<Comment[]> => [],
  create: async (input: CreateInput): Promise<Comment> => ({
    ...input,
    environmentId: 1,
    author: { name: "Reviewer", image: null },
    createdAt: 1,
    resolved: false,
  }),
  setResolved: async (_input: {
    id: string;
    pageId: number;
    resolved: boolean;
  }): Promise<Comment> => {
    throw new Error("Not implemented");
  },
};

Object.assign(globalThis, {
  React,
  __commentsTestApi: api,
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/queries") {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export const pageQueries = { getById: (id) => ({ queryKey: ["page", id] }) };
          export const blockQueries = { get: (id) => ({ queryKey: ["block", id] }) };
          export const commentQueries = {
            list: (id) => ({
              queryKey: ["comments", id],
              queryFn: () => globalThis.__commentsTestApi.list(id),
              staleTime: Infinity,
            }),
          };
          export const commentMutations = {
            create: () => ({ mutationFn: (input) => globalThis.__commentsTestApi.create(input) }),
            setResolved: () => ({ mutationFn: (input) => globalThis.__commentsTestApi.setResolved(input) }),
          };
        `)}`,
        shortCircuit: true,
      };
    }
    if (specifier.endsWith("/CamoxAppContext")) {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export const useCamoxApp = () => ({
            getBlockById: () => ({
              _internal: { contentSchema: { properties: {
                title: { fieldType: "String" },
                image: { fieldType: "Image" },
                items: { items: { properties: { caption: { fieldType: "String" } } } },
              } } },
            }),
          });
        `)}`,
        shortCircuit: true,
      };
    }
    if (specifier === "@camox/ui/toaster") {
      return {
        url: "data:text/javascript,export const toast = { error() {}, success() {} }",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { queryFn: async () => null, staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  });
}

function comment(id: string, pageId: number, target: CommentTarget | null): Comment {
  return {
    id,
    pageId,
    environmentId: 1,
    target,
    message: `Feedback ${id}`,
    author: { name: "Reviewer", image: null },
    createdAt: 1,
    resolved: false,
  };
}

void test("Feedback reads persisted comments at every target level without a composer", async () => {
  const { CommentSidebar } = await import("./CommentSidebar");
  const { AttachedComments } = await import("./AttachedComments");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const client = makeClient();
  client.setQueryData(["page", 3], { nickname: "Homepage" });
  client.setQueryData(["comments", 3], []);
  client.setQueryData(["block", 7], {
    block: {
      id: 7,
      type: "hero",
      summary: "Our latest work",
      content: { title: "Build something great", image: { _file: 9 } },
    },
    repeatableItems: [
      {
        id: 12,
        fieldName: "items",
        parentItemId: null,
        summary: "Featured project",
        content: { caption: plainTextToLexicalState("Thoughtfully designed") },
      },
    ],
  });
  const render = (children: React.ReactNode) =>
    renderToStaticMarkup(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  assert.match(render(<CommentSidebar pageId={3} />), /No feedback yet/);

  const targets: CommentTarget[] = [
    { kind: "page" },
    { kind: "block", blockId: 7 },
    { kind: "item", blockId: 7, itemId: 12 },
    { kind: "block-field", blockId: 7, fieldName: "title" },
    { kind: "item-field", blockId: 7, itemId: 12, fieldName: "caption" },
    { kind: "block-field", blockId: 7, fieldName: "image" },
  ];
  client.setQueryData(
    ["comments", 3],
    targets.map((target, i) => comment(String(i), 3, target)),
  );
  const markup = render(<CommentSidebar pageId={3} />);
  for (const [index] of targets.entries()) assert.match(markup, new RegExp(`Feedback ${index}`));
  for (const quote of [
    "Homepage",
    "Our latest work",
    "Featured project",
    "Build something great",
    "Thoughtfully designed",
  ]) {
    assert.ok(markup.includes(quote), quote);
  }
  assert.equal((markup.match(/<blockquote/g) ?? []).length, targets.length);
  assert.doesNotMatch(markup, /Comment text|Post comment/);
  assert.doesNotMatch(markup, /role="button"|hover:bg-card/);
  assert.equal((markup.match(/>View<\/button>/g) ?? []).length, targets.length);
  assert.equal((markup.match(/>Archive<\/button>/g) ?? []).length, targets.length);
  assert.doesNotMatch(markup, /See all|>Done<\/button>/);
  assert.doesNotMatch(render(<CommentSidebar pageId={4} />), /Feedback 0/);

  previewCommentsStore.send({ type: "startComment", pageId: 3, target: targets[4]! });
  previewCommentsStore.send({ type: "setMessage", message: "Draft feedback" });
  assert.doesNotMatch(render(<CommentSidebar pageId={3} />), /Draft feedback/);
  const editor = render(
    <AttachedComments pageId={3} blockId={7} itemId={12} fieldName="caption" />,
  );
  assert.match(editor, /Draft feedback/);
  assert.match(editor, /Comment text/);
  assert.match(editor, /Post comment/);
  assert.match(editor, />See all<\/button>/);
  assert.match(editor, />Archive<\/button>/);
  assert.doesNotMatch(editor, />View<\/button>/);
  client.setQueryData(["comments", 3], [comment("removed", 3, null)]);
  const unavailable = render(<CommentSidebar pageId={3} />);
  assert.match(unavailable, /Feedback removed/);
  assert.match(unavailable, /Target no longer available/);
  assert.doesNotMatch(unavailable, /role="button"/);
  client.clear();
  previewCommentsStore.send({ type: "clearSelection" });
});

async function setupDom() {
  const { Window } = await import("happy-dom");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    ResizeObserver: window.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const client = makeClient();
  return {
    window,
    host,
    client,
    async render(children: React.ReactNode) {
      await React.act(async () =>
        root.render(<QueryClientProvider client={client}>{children}</QueryClientProvider>),
      );
    },
    async close() {
      await React.act(async () => root.unmount());
      client.clear();
      await window.happyDOM.close();
    },
  };
}

void test("feedback prompt scopes the request to one page and includes optional context", async () => {
  const { feedbackPrompt } = await import("./SendFeedbackDialog");
  const request = feedbackPrompt(88, "   ");
  assert.match(request, /page ID 88/);
  assert.match(request, /Load the camox skill/);
  assert.match(request, /resolve each addressed comment/);
  assert.doesNotMatch(request, /Additional context|Lorem ipsum/);
  assert.equal(
    feedbackPrompt(88, "  Prioritize the hero  "),
    `${request}\n\nAdditional context:\nPrioritize the hero`,
  );
});

void test("only View opens feedback's editor without deleting cached comments", async () => {
  const dom = await setupDom();
  const { CommentSidebar } = await import("./CommentSidebar");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const { previewStore } = await import("../previewStore");
  dom.client.setQueryData(["page", 88], { nickname: "Test page" });
  const comments = ["first", "second"].map((id) => comment(id, 88, { kind: "page" }));
  dom.client.setQueryData(["comments", 88], comments);
  try {
    previewStore.send({ type: "enterEditMode" });
    previewStore.send({ type: "setCommentMode", enabled: true });
    previewCommentsStore.send({ type: "clearSelection" });
    await dom.render(<CommentSidebar pageId={88} />);
    await React.act(async () => dom.host.querySelector("p")!.click());
    assert.equal(previewCommentsStore.getSnapshot().context.activeId, null);
    const viewButtons = [...dom.host.querySelectorAll("button")].filter(
      (button) => button.textContent === "View",
    );
    await React.act(async () => viewButtons[0]!.click());
    assert.equal(previewStore.getSnapshot().context.mode, "editing-draft");
    assert.equal(previewStore.getSnapshot().context.selection, null);
    assert.equal(previewCommentsStore.getSnapshot().context.activeId, "first");
    await React.act(async () => viewButtons[1]!.click());
    assert.equal(previewCommentsStore.getSnapshot().context.activeId, "second");
    assert.deepEqual(dom.client.getQueryData(["comments", 88]), comments);
  } finally {
    await dom.close();
    previewCommentsStore.send({ type: "clearSelection" });
    previewStore.send({ type: "exitEditMode" });
  }
});

void test("See all returns from a specific comment to page feedback", async () => {
  const dom = await setupDom();
  const { AttachedComments } = await import("./AttachedComments");
  const { previewStore } = await import("../previewStore");
  dom.client.setQueryData(["comments", 3], [comment("one", 3, { kind: "page" })]);
  try {
    previewStore.send({ type: "enterEditMode" });
    await dom.render(<AttachedComments pageId={3} />);
    const seeAll = [...dom.host.querySelectorAll("button")].find(
      (button) => button.textContent === "See all",
    );
    assert.ok(seeAll);
    await React.act(async () => seeAll.click());
    assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
  } finally {
    await dom.close();
    previewStore.send({ type: "exitEditMode" });
  }
});

void test("failed posting retains a retryable draft; success persists without clearing newer input", async () => {
  const dom = await setupDom();
  const { AttachedComments } = await import("./AttachedComments");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const inputs: CreateInput[] = [];
  const saved: Comment[] = [];
  const originalCreate = api.create;
  const originalList = api.list;
  api.list = async () => saved;
  api.create = async (input) => {
    inputs.push(input);
    if (inputs.length === 1) throw new Error("offline");
    const created = await originalCreate(input);
    saved.push(created);
    return created;
  };
  dom.client.setQueryData(["comments", 3], []);
  previewCommentsStore.send({ type: "startComment", pageId: 3, target: { kind: "page" } });
  previewCommentsStore.send({ type: "setMessage", message: "Keep this draft" });
  const submitted = previewCommentsStore.getSnapshot().context.draft!;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    await dom.render(<AttachedComments pageId={3} />);
    const post = () => {
      const button = dom.host.querySelector('[aria-label="Post comment"]');
      assert.ok(button instanceof dom.window.HTMLButtonElement);
      button.click();
    };
    await React.act(async () => {
      post();
      await flush();
    });
    assert.match(dom.host.textContent, /Could not post feedback/);
    assert.equal(previewCommentsStore.getSnapshot().context.draft?.id, submitted.id);
    await React.act(async () => {
      post();
      await flush();
    });
    assert.equal(inputs[0]?.id, inputs[1]?.id);
    assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
    assert.equal(saved.length, 1);
    assert.match(dom.host.textContent, /Keep this draft/);

    let complete!: (value: Comment) => void;
    api.create = (input) => {
      inputs.push(input);
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    await React.act(async () => {
      previewCommentsStore.send({ type: "startComment", pageId: 3, target: { kind: "page" } });
      previewCommentsStore.send({ type: "setMessage", message: "Earlier message" });
    });
    await React.act(async () => {
      post();
      await flush();
    });
    await React.act(async () => {
      previewCommentsStore.send({ type: "setMessage", message: "Newer message" });
      complete(await originalCreate(inputs[2]!));
      await flush();
    });
    assert.equal(previewCommentsStore.getSnapshot().context.draft?.message, "Newer message");
  } finally {
    api.create = originalCreate;
    api.list = originalList;
    await dom.close();
    previewCommentsStore.send({ type: "clearSelection" });
  }
});

void test("resolved feedback stays hidden in sidebar and object views", async () => {
  const dom = await setupDom();
  const { AttachedComments } = await import("./AttachedComments");
  const { CommentSidebar } = await import("./CommentSidebar");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const originalList = api.list;
  const originalSetResolved = api.setResolved;
  let saved = [comment("one", 3, { kind: "page" })];
  api.list = async () => saved;
  api.setResolved = async (input) => {
    saved = saved.map((entry) =>
      entry.id === input.id ? { ...entry, resolved: input.resolved } : entry,
    );
    return saved[0]!;
  };
  dom.client.setQueryData(["comments", 3], saved);
  previewCommentsStore.send({ type: "clearSelection" });
  const click = async (selector: string) => {
    await React.act(async () => {
      const element = dom.host.querySelector(selector);
      assert.ok(element instanceof dom.window.HTMLElement);
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  try {
    await dom.render(<CommentSidebar pageId={3} />);
    assert.equal(dom.host.querySelector('input[type="checkbox"]'), null);
    const succeed = api.setResolved;
    api.setResolved = async () => {
      throw new Error("offline");
    };
    await click('[aria-label="Archive comment"]');
    assert.equal(saved[0]?.resolved, false);
    assert.match(dom.host.textContent, /Feedback one/);
    api.setResolved = succeed;
    await click('[aria-label="Archive comment"]');
    assert.equal(saved[0]?.resolved, true);
    assert.equal(previewCommentsStore.getSnapshot().context.activeId, null);
    assert.doesNotMatch(dom.host.textContent, /Show resolved|Feedback one/);
    assert.match(dom.host.textContent, /No unresolved feedback/);
    assert.equal(dom.host.querySelector('input[type="checkbox"]'), null);
    await dom.render(<AttachedComments pageId={3} blockId={7} />);
    assert.doesNotMatch(dom.host.textContent, /Show resolved|Feedback one/);
    await dom.render(<AttachedComments pageId={3} />);
    assert.doesNotMatch(dom.host.textContent, /Show resolved|Feedback one/);
    assert.equal(dom.host.querySelector('[aria-label="Restore comment"]'), null);
  } finally {
    api.list = originalList;
    api.setResolved = originalSetResolved;
    await dom.close();
    previewCommentsStore.send({ type: "clearSelection" });
  }
});

void test("feedback loads with experimental features unset or disabled and still requires a page", async () => {
  const dom = await setupDom();
  const { AttachedComments } = await import("./AttachedComments");
  const { usePageComments } = await import("../usePageComments");
  const flags = globalThis as typeof globalThis & {
    __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__?: boolean;
  };
  const previousFlag = flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
  const originalList = api.list;
  const requests: number[] = [];
  api.list = async (pageId) => {
    requests.push(pageId);
    return [comment("default", pageId, { kind: "page" })];
  };
  function ToolbarQuery({ pageId }: { pageId?: number }) {
    usePageComments(pageId);
    return null;
  }
  try {
    for (const [index, flag] of [undefined, false].entries()) {
      if (flag === undefined) delete flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
      else flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ = flag;
      await dom.render(<ToolbarQuery />);
      assert.equal(requests.length, index);
      const pageId = index + 3;
      await dom.render(
        <>
          <ToolbarQuery pageId={pageId} />
          <AttachedComments pageId={pageId} />
        </>,
      );
      await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      assert.match(dom.host.textContent, /Feedback default/);
      assert.deepEqual(requests, index === 0 ? [3] : [3, 4]);
    }
  } finally {
    api.list = originalList;
    if (previousFlag === undefined) delete flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
    else flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ = previousFlag;
    await dom.close();
  }
});
