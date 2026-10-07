import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { createApp } from "@/core/createApp";
import { createCollection, Type } from "@/core/createCollection";
import {
  CollectionItemModalProvider,
  useCollectionItemModal,
} from "@/features/content/CollectionItemModalContext";
import { CamoxAppProvider } from "@/features/provider/components/CamoxAppContext";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import type { NormalizedCollectionRecord } from "@/lib/normalized-data";
import { collectionQueries } from "@/lib/queries";

import { referencePickerFocus } from "../referencePickerFocus";

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", "development");

const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "",
  label: "name",
  content: {
    name: Type.String({ title: "Name" }),
    company: Type.String({ title: "Company" }),
    logo: Type.Image({ title: "Logo" }),
  },
});
const app = createApp({ blocks: [], collections: [customers] });

const ADA = "a6479288-341f-4008-b118-dea6d8dd9158";
const GRACE = "4f0b4a8f-1df4-4b44-9c1a-2b67b10e1e4b";
const CREATED = "8b2f3b1e-6c9f-4f0e-9a43-0b9b6e3f6b7d";

type RecordSummary = { id: string; label: string; status: string; version: number };

const defaultRecords: RecordSummary[] = [
  { id: ADA, label: "Ada", status: "published", version: 2 },
  { id: GRACE, label: "Grace", status: "draft", version: 1 },
];

const adaRecord: NormalizedCollectionRecord = {
  id: ADA,
  collectionId: "customers",
  label: "Ada",
  version: 2,
  content: {
    name: "Ada",
    company: "Analytical Engines",
    logo: {
      url: "https://assets.example.com/ada-logo.png",
      alt: "Ada logo",
      filename: "ada-logo.png",
      mimeType: "image/png",
      _fileId: "5",
    },
  },
};

async function renderReference(
  options: {
    value?: string | null;
    required?: boolean;
    records?: RecordSummary[];
    record?: NormalizedCollectionRecord | null;
    modal?: React.ReactNode;
    fieldId?: string;
  } = {},
) {
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
    KeyboardEvent: window.KeyboardEvent,
    SubmitEvent: window.SubmitEvent,
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
  client.setQueryData(
    collectionQueries.records("site", "customers").queryKey,
    options.records ?? defaultRecords,
  );
  client.setQueryData(collectionQueries.get("site", "customers").queryKey, {
    collectionId: "customers",
    title: "Customers",
    description: "",
    label: "name",
    contentSchema: JSON.parse(JSON.stringify(customers._internal.contentSchema)),
  });
  const changes: (string | null)[] = [];
  const control = { reject: false };
  let modal!: ReturnType<typeof useCollectionItemModal>;
  function Editor() {
    const [value, setValue] = React.useState<string | null>(options.value ?? null);
    return (
      <ReferenceFieldEditor
        collectionId="customers"
        fieldId={options.fieldId}
        required={options.required}
        record={options.record ?? null}
        value={value}
        onChange={(id) => {
          if (control.reject) return Promise.reject(new Error("Link failed"));
          changes.push(id);
          setValue(id);
        }}
      />
    );
  }
  function ModalProbe() {
    modal = useCollectionItemModal();
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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
          <CamoxAppProvider app={app}>
            <CollectionItemModalProvider onRouteTargetClose={() => {}}>
              <Editor />
              <ModalProbe />
              {options.modal}
            </CollectionItemModalProvider>
          </CamoxAppProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
  });

  const find = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('button,[role="option"]')].find(
      (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === text,
    );
  const click = async (text: string) => {
    const element = find(text);
    assert.ok(element, `missing control: ${text}`);
    await act(async () => {
      if (element.hasAttribute("aria-haspopup")) {
        element.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          }) as unknown as KeyboardEvent,
        );
        return;
      }
      element.click();
    });
  };
  const search = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search items"]');
    assert.ok(input, "search input is open");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    });
  };
  const options_ = () =>
    [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);

  return {
    window,
    host,
    client,
    changes,
    control,
    get modal() {
      return modal;
    },
    find,
    click,
    search,
    options: options_,
    text: () => host.textContent ?? "",
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
      client.clear();
      await window.happyDOM.close();
    },
  };
}

void test("a linked record shows a card with its thumbnail, label, publication badge and collection", async () => {
  const view = await renderReference({ value: ADA, record: adaRecord });
  try {
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card, "linked records render a record card");
    assert.match(card.textContent ?? "", /Ada/);
    assert.match(card.textContent ?? "", /Published/);
    assert.match(card.textContent ?? "", /Customers/);
    const thumbnail = card.querySelector("img");
    assert.ok(thumbnail, "the first image field is the thumbnail");
    assert.match(thumbnail.getAttribute("src") ?? "", /ada-logo\.png/);
    assert.ok(!view.host.querySelector('[role="combobox"]'), "no picker while linked");
    await view.click("Open Ada");
    assert.equal(view.modal.target?.itemId, ADA, "the card still opens the edit modal");
    assert.deepEqual(view.changes, []);
  } finally {
    await view.cleanup();
  }
});

void test("a record without an image falls back to an icon", async () => {
  const view = await renderReference({
    value: ADA,
    record: { ...adaRecord, content: { ...adaRecord.content, logo: null } },
  });
  try {
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card);
    assert.ok(!card.querySelector("img"));
    assert.ok(card.querySelector("svg"), "icon fallback");
  } finally {
    await view.cleanup();
  }
});

void test("unlinking clears the reference immediately and restores the picker", async () => {
  const view = await renderReference({ value: ADA, record: adaRecord });
  try {
    await view.click("Unlink");
    assert.deepEqual(view.changes, [null]);
    assert.equal(view.modal.target, null, "no confirmation or delete dialog opens");
    assert.ok(!view.host.querySelector("[data-record-card]"));
    assert.ok(view.host.querySelector('[role="combobox"]'), "unlinking restores the picker");
  } finally {
    await view.cleanup();
  }
});

void test("the picker searches records by label, shows their publication, and links the choice", async () => {
  const view = await renderReference();
  try {
    assert.ok(!view.find("Create item"), "creating lives only in the picker");
    await view.click("Select item");
    assert.deepEqual(view.options(), ["AdaPublished", "GraceDraft"]);
    await view.search("gra");
    assert.deepEqual(view.options(), ["GraceDraft"]);
    await view.search("nobody");
    assert.deepEqual(view.options(), []);
    assert.match(document.body.textContent ?? "", /No items found/);
    await view.search("Ada");
    await view.click("AdaPublished");
    assert.deepEqual(view.changes, [ADA]);
    assert.ok(view.host.querySelector("[data-record-card]"));
    assert.ok(!view.host.querySelector('[role="combobox"]'));
  } finally {
    await view.cleanup();
  }
});

void test("the picker explains when the collection has no records yet", async () => {
  const view = await renderReference({ records: [] });
  try {
    await view.click("Select item");
    assert.deepEqual(view.options(), []);
    assert.match(document.body.textContent ?? "", /Customers has no items yet/);
    assert.ok(view.find("Create item"), "creating stays available from the footer");
  } finally {
    await view.cleanup();
  }
});

void test("Create item prefills the label from the search, links the saved record, and cancel changes nothing", async (t: TestContext) => {
  const created: Record<string, unknown>[] = [];
  let records = defaultRecords;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as { json: Record<string, unknown> };
    if (path.endsWith("/createRecord")) {
      created.push(body.json);
      records = [{ id: CREATED, label: "Acme", status: "draft", version: 1 }, ...defaultRecords];
      return Response.json({ json: { id: CREATED, version: 1, draft: body.json.content } });
    }
    if (path.endsWith("/listRecords")) return Response.json({ json: records });
    return Response.json({ json: null });
  });
  const { ContentCollectionItemModal } = await import("@/features/content/ContentCollection");
  const view = await renderReference({ modal: <ContentCollectionItemModal projectSlug="site" /> });
  const nameField = () => document.querySelector<HTMLTextAreaElement>("#collection-name");
  const createFromSearch = async (search: string) => {
    await view.click("Select item");
    await view.search(search);
    await view.click("Create item");
  };
  try {
    await createFromSearch("Acme");
    assert.equal(nameField()?.value, "Acme", "the label field is prefilled from the search");
    await view.click("Close");
    assert.ok(!view.modal.target, "cancel closes the modal");
    assert.deepEqual(view.changes, [], "cancel leaves the link unchanged");
    assert.deepEqual(created, []);

    await createFromSearch("Acme");
    const form = nameField()?.closest("form");
    assert.ok(form);
    await act(async () => {
      form.dispatchEvent(
        new view.window.SubmitEvent("submit", {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.deepEqual(created, [
      {
        projectSlug: "site",
        collectionId: "customers",
        content: { name: "Acme", company: "", logo: null },
      },
    ]);
    assert.deepEqual(view.changes, [CREATED], "the saved record is linked");
    assert.ok(!view.modal.target, "the modal closes after linking");
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card, "the view stays on the reference and shows the new card");
    assert.match(card.textContent ?? "", /Acme/);
  } finally {
    await view.cleanup();
  }
});

void test("hints flag a missing required reference and a never-published linked record", async () => {
  const cases: {
    name: string;
    value: string | null;
    required: boolean;
    expected: string | null;
  }[] = [
    { name: "unset optional", value: null, required: false, expected: null },
    { name: "unset required", value: null, required: true, expected: "Required" },
    { name: "published optional", value: ADA, required: false, expected: null },
    { name: "published required", value: ADA, required: true, expected: null },
    {
      name: "draft optional",
      value: GRACE,
      required: false,
      expected: "Won't appear on the live site until published",
    },
    {
      name: "draft required",
      value: GRACE,
      required: true,
      expected: "Blocks publishing until this record is included",
    },
  ];
  for (const { name, value, required, expected } of cases) {
    const view = await renderReference({ value, required });
    try {
      const hint = view.host.querySelector("[data-reference-hint]")?.textContent ?? null;
      assert.equal(hint, expected, name);
    } finally {
      await view.cleanup();
    }
  }
});

void test("a failed link keeps the create modal open and reports the error", async () => {
  const view = await renderReference();
  try {
    await view.click("Select item");
    await view.click("Create item");
    const target = view.modal.target;
    assert.ok(target);
    view.control.reject = true;
    await act(async () => {
      await assert.rejects(view.modal.complete(target, { id: CREATED }), /Link failed/);
    });
    assert.equal(view.modal.target, target, "the modal stays open to retry");
    assert.match(view.host.querySelector('[role="alert"]')?.textContent ?? "", /Link failed/);
    assert.deepEqual(view.changes, []);
  } finally {
    await view.cleanup();
  }
});

void test("selecting an unset reference from the preview placeholder focuses its record picker", async () => {
  referencePickerFocus.send({ type: "request", fieldId: "3__customer" });
  const other = await renderReference({ fieldId: "4__customer" });
  try {
    assert.ok(
      !document.querySelector('input[aria-label="Search items"]'),
      "other placements stay closed",
    );
  } finally {
    await other.cleanup();
  }

  const view = await renderReference({ fieldId: "3__customer" });
  try {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search items"]');
    assert.ok(input, "the picker opens");
    assert.ok(document.activeElement === input, "the search input has focus");
    assert.equal(
      referencePickerFocus.getSnapshot().context.fieldId,
      null,
      "the request is consumed",
    );
    await view.search("gra");
    assert.deepEqual(view.options(), ["GraceDraft"]);
  } finally {
    await view.cleanup();
  }
});
