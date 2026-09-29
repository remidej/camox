import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window, type HTMLButtonElement } from "happy-dom";
import * as React from "react";

void test("standalone publication reviews a version, defaults on, cancels, handles conflicts and unpublishes", async (t) => {
  const window = new Window();
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MutationObserver: window.MutationObserver,
    PointerEvent: window.PointerEvent,
    KeyboardEvent: window.KeyboardEvent,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __CAMOX_TELEMETRY_DISABLED__: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { PublishCollectionItemButton } = await import("./components/PublishCollectionItemButton");
  const { initApiClient } = await import("@/lib/api-client");
  const { collectionQueries } = await import("@/lib/queries");
  initApiClient("http://localhost:8788", "development");
  const id = "a6479288-341f-4008-b118-dea6d8dd9158";
  const calls: { url: string; input: unknown }[] = [];
  let fail = false;
  let responseReady = Promise.resolve();
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    calls.push({ url: request.url, input: ((await request.json()) as { json: unknown }).json });
    await responseReady;
    if (fail)
      return Response.json(
        {
          json: {
            defined: false,
            code: "CONFLICT",
            status: 409,
            message: "Record changed; reload before retrying",
          },
        },
        { status: 409 },
      );
    const record = { id, version: 4, draft: { name: "Ada" } };
    return Response.json({ json: request.url.endsWith("/publishRecord") ? { record } : record });
  });
  const client = new QueryClient();
  const listKey = collectionQueries.records("site", "customers").queryKey;
  client.setQueryData(listKey, []);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = async (version: number, status: "draft" | "published" | "modified" = "draft") =>
    React.act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <PublishCollectionItemButton
            projectSlug="site"
            collectionId="customers"
            record={{ id, version, status, label: "Ada" }}
          />
        </QueryClientProvider>,
      ),
    );
  const click = async (element: { click: () => void } | null) => {
    assert.ok(element);
    await React.act(async () => {
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  };
  const dialog = () => window.document.querySelector('[role="alertdialog"]')!;
  const action = () =>
    dialog().querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')!;
  const cancel = () =>
    dialog().querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')!;
  try {
    await render(2);
    assert.equal(host.querySelector('[data-slot="badge"]'), null);
    assert.equal(
      host.querySelector('[data-slot="button-group"]')?.querySelectorAll("button").length,
      2,
    );
    assert.equal(host.querySelector<HTMLButtonElement>("button")?.disabled, false);
    const group = host.querySelector('[data-slot="button-group"]')!;
    assert.ok(group.classList.contains("opacity-0"));
    assert.ok(group.classList.contains("group-hover:opacity-100"));
    assert.ok(group.classList.contains("group-focus-within:opacity-100"));
    const more = () =>
      host.querySelector<HTMLButtonElement>('[aria-label="More publish actions"]')!;
    const menuItems = () => [
      ...window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    await click(more());
    assert.deepEqual(
      menuItems().map((item) => item.textContent),
      ["Unpublish", "Discard changes"],
    );
    assert.ok(menuItems().every((item) => item.getAttribute("aria-disabled") === "true"));
    await click(more());
    await click(host.querySelector("button"));
    assert.match(dialog().textContent, /No page, block, or other item/);
    const toggle = dialog().querySelector<HTMLButtonElement>('[role="switch"]')!;
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    await click(toggle);
    assert.equal(action().disabled, true);
    assert.equal(calls.length, 0);
    await click(cancel());
    await click(host.querySelector("button"));
    assert.equal(dialog().querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
    // A background update must not change the version already being reviewed.
    await render(3);
    fail = true;
    await click(action());
    assert.deepEqual(calls[0].input, {
      projectSlug: "site",
      collectionId: "customers",
      id,
      expectedVersion: 2,
    });
    assert.match(dialog().querySelector('[role="alert"]')!.textContent, /reload/);
    await click(cancel());
    fail = false;
    let releaseResponse!: () => void;
    responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await click(host.querySelector("button"));
    await click(action());
    assert.equal(action().disabled, true);
    assert.equal(cancel().disabled, true);
    assert.equal(dialog().querySelector('[role="switch"]')!.hasAttribute("data-disabled"), true);
    assert.match(action().textContent, /Publishing/);
    await React.act(async () => {
      releaseResponse();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    assert.deepEqual(calls.at(-1)?.input, {
      projectSlug: "site",
      collectionId: "customers",
      id,
      expectedVersion: 3,
    });
    assert.equal(client.getQueryState(listKey)?.isInvalidated, true);
    assert.deepEqual(
      client.getQueryData(collectionQueries.record("site", "customers", id).queryKey),
      {
        id,
        version: 4,
        draft: { name: "Ada" },
      },
    );
    await render(4, "published");
    assert.equal(host.querySelectorAll("button").length, 2);
    assert.equal(host.querySelector<HTMLButtonElement>("button")?.disabled, true);
    await click(more());
    assert.equal(menuItems()[1].getAttribute("aria-disabled"), "true");
    await click(menuItems()[0]);
    assert.match(dialog().textContent, /draft and history are kept/);
    const before = calls.length;
    await click(cancel());
    assert.equal(calls.length, before);
    await click(more());
    await click(menuItems()[0]);
    await click(action());
    assert.ok(calls.at(-1)?.url.endsWith("/unpublishRecord"));
    assert.deepEqual(calls.at(-1)?.input, {
      projectSlug: "site",
      collectionId: "customers",
      id,
      expectedVersion: 4,
    });
    await render(5, "modified");
    assert.equal(host.querySelector<HTMLButtonElement>("button")?.disabled, false);
    assert.equal(host.querySelector("button")?.textContent, "Publish changes");
    await click(more());
    assert.ok(menuItems().every((item) => item.getAttribute("aria-disabled") !== "true"));
    await click(menuItems().find((item) => item.textContent === "Discard changes")!);
    assert.match(dialog().textContent, /does not change what visitors see/);
    await render(6, "modified");
    await click(action());
    assert.ok(calls.at(-1)?.url.endsWith("/discardRecord"));
    assert.deepEqual(calls.at(-1)?.input, {
      projectSlug: "site",
      collectionId: "customers",
      id,
      expectedVersion: 5,
    });
  } finally {
    await React.act(async () => root.unmount());
    client.clear();
    await window.happyDOM.close();
  }
});
