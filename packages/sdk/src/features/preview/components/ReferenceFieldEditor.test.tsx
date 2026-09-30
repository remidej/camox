import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import {
  CollectionItemModalProvider,
  useCollectionItemModal,
} from "@/features/content/CollectionItemModalContext";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { collectionQueries } from "@/lib/queries";

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", "development");

void test("reference view attaches and unlinks identities, and delegates content to the shared modal", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Element: window.Element,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    PointerEvent: window.PointerEvent,
    Event: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { ReferenceFieldEditor } = await import("./ReferenceFieldEditor");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(collectionQueries.records("site", "customers").queryKey, [
    { id: "one", label: "Ada", status: "published" },
    { id: "two", label: "Grace", status: "draft" },
  ]);
  const changes: (string | null)[] = [];
  let rejectAttachment = false;
  let modalState!: ReturnType<typeof useCollectionItemModal>;
  function Editor() {
    const [value, setValue] = React.useState<string | null>(null);
    return (
      <ReferenceFieldEditor
        collectionId="customers"
        value={value}
        onChange={(id) => {
          if (rejectAttachment) return Promise.reject(new Error("Attachment failed"));
          changes.push(id);
          setValue(id);
        }}
      />
    );
  }
  function ModalProbe() {
    const modal = useCollectionItemModal();
    modalState = modal;
    return (
      <>
        <output data-modal-target>
          {modal.target ? `${modal.target.collectionId}:${modal.target.itemId ?? "new"}` : "closed"}
        </output>
        <button type="button" onClick={modal.close}>
          Cancel modal
        </button>
        <button
          type="button"
          onClick={() => {
            if (modal.target) void modal.complete(modal.target, { id: "created" });
          }}
        >
          Save modal
        </button>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const click = async (text: string) => {
    const button = [...document.querySelectorAll<HTMLElement>('button,[role="option"]')].find(
      (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === text,
    );
    assert.ok(button, text);
    await act(async () => {
      if (button.hasAttribute("aria-haspopup")) {
        button.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          }) as unknown as KeyboardEvent,
        );
        return;
      }
      button.click();
    });
  };
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AuthContext.Provider
            value={{
              projectSlug: "site",
              apiUrl: "http://localhost:8788",
              authenticationUrl: "http://localhost:3290",
              authClient: createCamoxAuthClient("http://localhost:8788"),
            }}
          >
            <CollectionItemModalProvider onRouteTargetClose={() => {}}>
              <Editor />
              <ModalProbe />
            </CollectionItemModalProvider>
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });
    assert.equal(host.querySelector("fieldset")?.querySelectorAll("button").length, 2);
    assert.equal(document.querySelector('[role="option"]'), null, "options stay in the combobox");
    assert.doesNotMatch(host.textContent ?? "", /Attach a shared item|and attach/);
    assert.equal(host.querySelector("textarea,[contenteditable]"), null);
    await click("Select item");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search items"]');
    assert.ok(search);
    const emptyStatus = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    assert.ok(emptyStatus);
    assert.equal(
      emptyStatus.childElementCount,
      0,
      "empty-state spacing must not render with results",
    );
    assert.doesNotMatch(emptyStatus.className, /\bp-\d/);
    assert.doesNotMatch(search.parentElement!.className, /\bgap-\d/);
    const searchFor = (value: string) =>
      act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!;
        descriptor.set!.call(search, value);
        search.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      });
    await searchFor("No matching customer");
    assert.match(emptyStatus.textContent ?? "", /No items found/);
    assert.ok(emptyStatus.querySelector(".p-2"), "only the empty message has padding");
    await searchFor("Ada");
    assert.equal(emptyStatus.childElementCount, 0);
    assert.deepEqual(
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
      ["Ada"],
    );
    await click("Ada");
    assert.deepEqual(changes, ["one"]);
    assert.doesNotMatch(host.textContent ?? "", /Create item/);
    assert.equal(
      host.querySelector('[role="combobox"]'),
      null,
      "linked items only show their card",
    );
    await click("Edit Ada");
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "customers:one");
    await click("Cancel modal");
    assert.deepEqual(changes, ["one"], "editing/cancelling does not replace the reference");
    await click("Unlink");
    assert.deepEqual(changes, ["one", null]);
    assert.equal(host.querySelector('[aria-label="Unlink"]'), null);
    assert.ok(host.querySelector('[role="combobox"]'), "unlinking restores the picker");
    await click("Create item");
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "customers:new");
    assert.deepEqual(changes, ["one", null], "opening the modal does not create an attachment");
    const dismissedModal = modalState;
    const dismissedTarget = dismissedModal.target!;
    await click("Cancel modal");
    assert.deepEqual(changes, ["one", null]);
    await click("Create item");
    await act(async () => {
      await dismissedModal.complete(dismissedTarget, { id: "late-response" });
    });
    assert.deepEqual(changes, ["one", null], "a dismissed save must not attach its result");
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "customers:new");

    rejectAttachment = true;
    await act(async () => {
      await assert.rejects(
        modalState.complete(modalState.target!, { id: "created" }),
        /Attachment failed/,
      );
    });
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "customers:new");
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Attachment failed/);
    assert.deepEqual(changes, ["one", null], "failed attachments can retry without closing");
    rejectAttachment = false;
    await click("Save modal");
    assert.deepEqual(changes, ["one", null, "created"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    await window.happyDOM.close();
  }
});
