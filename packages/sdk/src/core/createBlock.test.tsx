import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider } from "../features/navigation/navigation";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { NormalizedDataProvider } from "../lib/normalized-data";
import { viewPageQueries, viewProjectQueries } from "../lib/view-queries";
import { createBlock, type ContentFieldBuilder } from "./createBlock";

const options = {
  id: "navigation",
  title: "Navigation",
  description: "Site navigation",
  content: (field: ContentFieldBuilder) => ({ title: field.string({ default: "Home" }) }),
  component: function Navigation() {
    return null;
  },
  toMarkdown: (content: { title: string }) => [content.title],
};

void test("repeaters without an item limit serialize without maxItems", () => {
  const block = createBlock({
    ...options,
    content: (field: ContentFieldBuilder) => ({
      items: field.repeater({
        content: (item) => ({ title: item.string({ default: "Item" }) }),
        minItems: 1,
        maxItems: Infinity,
        toMarkdown: (item) => [item.title],
      }),
    }),
    toMarkdown: () => [],
  });
  const schema = JSON.parse(JSON.stringify(block._internal.contentSchema));
  assert.equal("maxItems" in schema.properties.items, false);
});

void test("synced defaults to false", () => {
  assert.equal(createBlock(options)._internal.synced, false);
  assert.equal(createBlock({ ...options, synced: false })._internal.synced, false);
});

void test("synced is independent of layoutOnly", () => {
  const pageBlock = createBlock({ ...options, synced: true });
  assert.equal(pageBlock._internal.synced, true);
  assert.equal(pageBlock._internal.layoutOnly, false);
  const layoutBlock = createBlock({ ...options, synced: true, layoutOnly: true });
  assert.equal(layoutBlock._internal.synced, true);
  assert.equal(layoutBlock._internal.layoutOnly, true);
});

void test("rejects fields declared in the wrong context by untyped callers", () => {
  const setting = { fieldType: "Boolean", type: "boolean", default: true };
  const text = { fieldType: "String", type: "string", default: "" };
  assert.throws(
    () => createBlock({ ...options, content: () => ({ visible: setting }) } as never),
    /Boolean is a setting, not content/,
  );
  assert.throws(
    () => createBlock({ ...options, settings: () => ({ label: text }) } as never),
    /setting "label" must be an enum or a boolean/,
  );
});

void test("a link field renders a link to an existing page and plain text for a missing one", () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
  initApiClient("https://api.example.test");
  const projectId = 7;
  const existingPageId = "0199f0a0-0000-7000-8000-000000000001";
  const missingPageId = "0199f0a0-0000-7000-8000-000000000002";
  const block = createBlock({
    ...options,
    id: "cta",
    content: (field: ContentFieldBuilder) => ({
      cta: field.link({ default: { text: "Go", href: "/", newTab: false } }),
    }),
    component: () => <block.Link name="cta">{(props) => <a {...props} />}</block.Link>,
    toMarkdown: () => [],
  });
  const render = (pageId: string) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(viewProjectQueries.getBySlug("test").queryKey, {
      id: projectId,
    } as never);
    queryClient.setQueryData(viewPageQueries.list(projectId).queryKey, [
      { id: existingPageId, fullPath: "/pricing" },
    ]);
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ projectSlug: "test" } as React.ContextType<typeof AuthContext>}
        >
          <NavigationProvider>
            <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
              <block._internal.Component
                mode="site"
                blockData={{
                  _id: "1",
                  type: "cta",
                  position: "a0",
                  content: {
                    cta: { type: "page", pageId, text: "See pricing", newTab: false } as never,
                  },
                }}
              />
            </NormalizedDataProvider>
          </NavigationProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
  };
  assert.match(render(existingPageId), />(<a to="\/pricing">See pricing<\/a>)<\/div>$/);
  assert.match(render(missingPageId), />See pricing<\/div>$/);
});
