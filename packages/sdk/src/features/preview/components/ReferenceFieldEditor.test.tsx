import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { createApp } from "@/core/createApp";
import { createCollection } from "@/core/createCollection";
import type { ReferenceQuery } from "@/core/lib/contentType";
import {
  CollectionItemSheetProvider,
  useCollectionItemSheet,
} from "@/features/content/CollectionItemSheetContext";
import { CamoxAppProvider } from "@/features/provider/components/CamoxAppContext";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import type { NormalizedCollectionRecord } from "@/lib/normalized-data";

import {
  StudioQueryClientProvider,
  testDraftScope,
  testStudioCache,
} from "../../../lib/draft-scope.fixtures";
import { reads } from "../../../lib/studio-reads";
import { referencePickerFocus } from "../referencePickerFocus";

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "",
  content: (field) => ({
    name: field.string({ title: "Name" }),
    company: field.string({ title: "Company" }),
    logo: field.image({ title: "Logo" }),
  }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
});
const app = createApp({ blocks: [], collections: [customers] });

const ADA = "a6479288-341f-4008-b118-dea6d8dd9158";
const GRACE = "4f0b4a8f-1df4-4b44-9c1a-2b67b10e1e4b";
const CREATED = "8b2f3b1e-6c9f-4f0e-9a43-0b9b6e3f6b7d";

type RecordSummary = { id: string; title: string; description: string | null };

const defaultRecords: RecordSummary[] = [
  { id: ADA, title: "Ada", description: "Analytical Engines" },
  { id: GRACE, title: "Grace", description: null },
];

const adaRecord: NormalizedCollectionRecord = {
  id: ADA,
  collectionId: "customers",
  title: "Ada",
  description: null,
  content: {
    name: "Ada",
    company: "Analytical Engines",
    logo: {
      url: "https://assets.example.com/ada-logo.png",
      alt: "Ada logo",
      filename: "ada-logo.png",
      mimeType: "image/png",
      size: 2048,
      _fileId: 5,
    },
  },
};

async function renderReference(
  options: {
    value?: string | null;
    required?: boolean;
    records?: RecordSummary[];
    record?: NormalizedCollectionRecord | null;
    sheet?: React.ReactNode;
    fieldId?: string;
    /** Renders a query-backed reference list resolved to `record` instead of a reference. */
    query?: ReferenceQuery<any>;
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
  const { ReferenceListFieldEditor } = await import("./ReferenceListFieldEditor");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  testStudioCache(client).set(
    reads.records({ projectUuid: "site", collectionId: "customers" }),
    options.records ?? defaultRecords,
  );
  testStudioCache(client).set(
    reads.collection({ projectUuid: "site", collectionId: "customers" }),
    {
      collectionId: "customers",
      title: "Customers",
      description: "",
      toTitle: "{{name}}",
      toDescription: null,
      contentSchema: JSON.parse(JSON.stringify(customers._internal.contentSchema)),
    },
  );
  const changes: (string | null)[] = [];
  const opened: string[] = [];
  const control = { reject: false };
  let sheet!: ReturnType<typeof useCollectionItemSheet>;
  function Editor() {
    const [value, setValue] = React.useState<string | null>(options.value ?? null);
    if (options.query) {
      return (
        <ReferenceListFieldEditor
          collectionId="customers"
          value={undefined}
          query={options.query}
          records={options.record ? [options.record] : []}
          onOpenRecord={(id) => opened.push(id)}
        />
      );
    }
    return (
      <ReferenceFieldEditor
        collectionId="customers"
        fieldId={options.fieldId}
        required={options.required}
        record={options.record ?? null}
        value={value}
        onOpenRecord={(id) => opened.push(id)}
        onChange={(id) => {
          if (control.reject) return Promise.reject(new Error("Link failed"));
          changes.push(id);
          setValue(id);
        }}
      />
    );
  }
  function SheetProbe() {
    sheet = useCollectionItemSheet();
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <StudioQueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectUuid: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <CamoxAppProvider app={app}>
            <CollectionItemSheetProvider onRouteTargetClose={() => {}}>
              <Editor />
              <SheetProbe />
              {options.sheet}
            </CollectionItemSheetProvider>
          </CamoxAppProvider>
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  });

  const find = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('button,[role="option"]')].find(
      (element) =>
        (element.getAttribute("aria-label") ??
          element.querySelector("[data-record-title]")?.textContent ??
          element.textContent?.trim()) === text,
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
    [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.querySelector("[data-record-title]")?.textContent,
    );

  return {
    window,
    host,
    client,
    changes,
    opened,
    control,
    get sheet() {
      return sheet;
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

void test("a linked record shows a card with its title and collection", async () => {
  const view = await renderReference({ value: ADA, record: adaRecord });
  try {
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card, "linked records render a record card");
    assert.equal(card.textContent, "AdaCustomers");
    assert.ok(!card.querySelector("img"), "cards never show the record's image");
    assert.ok(!view.host.querySelector('[role="combobox"]'), "no picker while linked");
    await view.click("Open Ada");
    assert.deepEqual(view.opened, [ADA], "the card opens the record view");
    assert.ok(!view.sheet.target, "not the edit sheet");
    assert.deepEqual(view.changes, []);
  } finally {
    await view.cleanup();
  }
});

void test("unlinking clears the reference immediately and restores the picker", async () => {
  const view = await renderReference({ value: ADA, record: adaRecord });
  try {
    await view.click("Unlink");
    assert.deepEqual(view.changes, [null]);
    assert.equal(view.sheet.target, null, "no confirmation or delete dialog opens");
    assert.ok(!view.host.querySelector("[data-record-card]"));
    assert.ok(view.host.querySelector('[role="combobox"]'), "unlinking restores the picker");
  } finally {
    await view.cleanup();
  }
});

void test("the picker searches records by title and links the choice", async () => {
  const view = await renderReference();
  try {
    assert.ok(!view.find("Create item"), "creating lives only in the picker");
    await view.click("Select item");
    assert.deepEqual(view.options(), ["Ada", "Grace"]);
    await view.search("gra");
    assert.deepEqual(view.options(), ["Grace"]);
    await view.search("nobody");
    assert.deepEqual(view.options(), []);
    assert.match(document.body.textContent ?? "", /No items found/);
    await view.search("Ada");
    await view.click("Ada");
    assert.deepEqual(view.changes, [ADA]);
    assert.ok(view.host.querySelector("[data-record-card]"));
    assert.ok(!view.host.querySelector('[role="combobox"]'));
  } finally {
    await view.cleanup();
  }
});

void test("the picker shows each record's description under its title", async () => {
  const view = await renderReference();
  try {
    await view.click("Select item");
    const descriptions = [...document.querySelectorAll('[role="option"]')].map((option) =>
      option.textContent?.replace(
        option.querySelector("[data-record-title]")?.textContent ?? "",
        "",
      ),
    );
    assert.deepEqual(descriptions, ["Analytical Engines", ""]);
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

void test("Create item prefills the title's first field from the search, links the saved record, and cancel changes nothing", async (t: TestContext) => {
  const created: Record<string, unknown>[] = [];
  let records = defaultRecords;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as { json: Record<string, unknown> };
    if (path.endsWith("/createRecord")) {
      created.push(body.json);
      records = [{ id: CREATED, title: "Acme", description: null }, ...defaultRecords];
      return Response.json({
        json: { id: CREATED, content: body.json.content, createdAt: 1, updatedAt: 1 },
      });
    }
    if (path.endsWith("/listRecords")) return Response.json({ json: records });
    return Response.json({ json: null });
  });
  const { ContentCollectionItemSheet } = await import("@/features/content/ContentCollection");
  const view = await renderReference({ sheet: <ContentCollectionItemSheet projectUuid="site" /> });
  const nameField = () => document.querySelector<HTMLTextAreaElement>("#collection-name");
  const createFromSearch = async (search: string) => {
    await view.click("Select item");
    await view.search(search);
    await view.click("Create item");
  };
  try {
    await createFromSearch("Acme");
    assert.equal(
      nameField()?.value,
      "Acme",
      "the title's first field is prefilled from the search",
    );
    await view.click("Close");
    assert.ok(!view.sheet.target, "cancel closes the sheet");
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
        projectUuid: "site",
        collectionId: "customers",
        content: { name: "Acme", company: "", logo: null },
      },
    ]);
    assert.deepEqual(view.changes, [CREATED], "the saved record is linked");
    assert.ok(!view.sheet.target, "the sheet closes after linking");
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card, "the view stays on the reference and shows the new card");
    assert.match(card.textContent ?? "", /Acme/);
  } finally {
    await view.cleanup();
  }
});

void test("a hint flags only an unlinked required reference", async () => {
  const cases: {
    name: string;
    value: string | null;
    required: boolean;
    expected: string | null;
  }[] = [
    { name: "unset optional", value: null, required: false, expected: null },
    { name: "unset required", value: null, required: true, expected: "Required" },
    { name: "linked optional", value: ADA, required: false, expected: null },
    { name: "linked required", value: ADA, required: true, expected: null },
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

void test("a failed link keeps the create sheet open and reports the error", async () => {
  const view = await renderReference();
  try {
    await view.click("Select item");
    await view.click("Create item");
    const target = view.sheet.target;
    assert.ok(target);
    view.control.reject = true;
    await act(async () => {
      await assert.rejects(view.sheet.complete(target, { id: CREATED }), /Link failed/);
    });
    assert.equal(view.sheet.target, target, "the sheet stays open to retry");
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
    assert.deepEqual(view.options(), ["Grace"]);
  } finally {
    await view.cleanup();
  }
});

void test("a query-backed list summarizes how its query picks records", async () => {
  const cases: { query: ReferenceQuery<any>; expected: string }[] = [
    {
      query: { orderBy: { publishedAt: "desc" }, limit: 3 },
      expected: "Newest 3 by published date",
    },
    { query: { orderBy: { createdAt: "asc" }, limit: 5 }, expected: "Oldest 5 by creation date" },
    { query: { orderBy: { publishedAt: "desc" } }, expected: "Newest first by published date" },
    { query: { orderBy: { company: "asc" }, limit: 2 }, expected: "First 2 by Company, A to Z" },
    { query: { orderBy: { name: "desc" } }, expected: "All by Name, Z to A" },
    { query: {}, expected: "Oldest first by creation date" },
  ];
  for (const { query, expected } of cases) {
    const view = await renderReference({ query });
    try {
      const summary = view.host.querySelector("[data-query-summary]")?.textContent;
      assert.equal(summary, expected, JSON.stringify(query));
    } finally {
      await view.cleanup();
    }
  }
});

void test("a query-backed list shows its results as cards that open, with no list controls", async () => {
  const view = await renderReference({
    query: { orderBy: { name: "asc" } },
    record: adaRecord,
  });
  try {
    const card = view.host.querySelector<HTMLElement>("[data-record-card]");
    assert.ok(card);
    assert.equal(card.textContent, "AdaCustomers");
    for (const control of ["Unlink", "Reorder", "Select item", "Create item"]) {
      assert.ok(!view.find(control), `no ${control} control`);
    }
    await view.click("Open Ada");
    assert.deepEqual(view.opened, [ADA]);
  } finally {
    await view.cleanup();
  }
});
