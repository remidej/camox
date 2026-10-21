import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import {
  StudioQueryClientProvider,
  testDraftScope,
  readKey,
  testStudioCache,
} from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";

void test("both delete buttons require confirmation, allow cancellation, and retain errors for retry", async (t) => {
  // Initialize the DOM before importing UI components, which detect portals at module load.
  // In a draft already, so deleting doesn't start one and switch the cached queries' keys.
  const window = new Window({
    url: "http://localhost:3000/?camox-draft=019a0000-0000-7000-8000-000000000001",
  });
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MutationObserver: window.MutationObserver,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __CAMOX_TELEMETRY_DISABLED__: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { DeleteCollectionItemButton } = await import("./components/DeleteCollectionItemButton");
  const { initApiClient } = await import("@/lib/api-client");
  initApiClient("http://localhost:8788", testDraftScope());
  const calls: unknown[] = [];
  let fail = false;
  const id = "a6479288-341f-4008-b118-dea6d8dd9158";
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    assert.ok(request.url.endsWith("/deleteRecord"));
    calls.push(((await request.json()) as { json: unknown }).json);
    if (fail)
      return Response.json(
        {
          json: {
            defined: false,
            code: "INTERNAL_SERVER_ERROR",
            status: 500,
            message: "Could not delete; try again",
          },
        },
        { status: 500 },
      );
    return Response.json({ json: { id } });
  });
  for (const compact of [true, false]) {
    const client = new QueryClient();
    testStudioCache(client).set(
      reads.records({ projectUuid: "site", collectionId: "articles" }),
      [],
    );
    testStudioCache(client).set(
      reads.record({ projectUuid: "site", collectionId: "articles", id }),
      {
        id,
      },
    );
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const root = createRoot(host as unknown as HTMLElement);
    let deleted = 0;
    const click = async (element: { click: () => void }) => {
      await React.act(async () => {
        element.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
    };
    try {
      await React.act(async () =>
        root.render(
          <StudioQueryClientProvider client={client}>
            <DeleteCollectionItemButton
              projectUuid="site"
              collectionId="articles"
              id={id}
              label="Article"
              compact={compact}
              onDeleted={() => {
                deleted++;
              }}
            />
          </StudioQueryClientProvider>,
        ),
      );
      const before = calls.length;
      await click(host.querySelector("button")!);
      assert.equal(calls.length, before);
      let dialog = window.document.querySelector('[role="alertdialog"]')!;
      assert.ok(dialog.textContent.includes("“Article”"));
      assert.ok(!dialog.textContent.includes("revision history"));
      await click(
        dialog.querySelector('[data-slot="alert-dialog-cancel"]') as unknown as {
          click: () => void;
        },
      );
      assert.equal(calls.length, before);
      await click(host.querySelector("button")!);
      dialog = window.document.querySelector('[role="alertdialog"]')!;
      fail = true;
      await click(
        dialog.querySelector('[data-slot="alert-dialog-action"]') as unknown as {
          click: () => void;
        },
      );
      assert.equal(deleted, 0);
      assert.match(dialog.querySelector('[role="alert"]')!.textContent, /try again/);
      fail = false;
      await click(
        dialog.querySelector('[data-slot="alert-dialog-action"]') as unknown as {
          click: () => void;
        },
      );
      assert.equal(deleted, 1);
      assert.deepEqual(calls.at(-1), { projectUuid: "site", collectionId: "articles", id });
      assert.equal(
        testStudioCache(client).get(
          reads.record({ projectUuid: "site", collectionId: "articles", id }),
        ),
        undefined,
      );
      assert.equal(
        client.getQueryState(
          readKey(reads.records({ projectUuid: "site", collectionId: "articles" })),
        )?.isInvalidated,
        true,
      );
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
      client.clear();
    }
  }
  await window.happyDOM.close();
});
