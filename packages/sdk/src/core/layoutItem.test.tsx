import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider } from "../features/navigation/navigation";
import { CamoxAppProvider } from "../features/provider/components/CamoxAppContext";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { StudioQueryClientProvider, testDraftScope } from "../lib/draft-scope.fixtures";
import { createApp } from "./createApp";
import { createCollection } from "./createCollection";
import { createLayout, type AnyLayoutLoaderResult } from "./createLayout";
import { BlockEditingRuntimeProvider } from "./editing/BlockEditingRuntime";
import { plainTextToLexicalState } from "./lib/lexicalState";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test", testDraftScope());

const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  content: (field) => ({ name: field.string(), portrait: field.image() }),
  label: "name",
});

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    cover: field.image(),
    author: field.reference(authors),
  }),
  label: "title",
});

const ARTICLE_ID = "00000000-0000-4000-8000-000000000001";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000002";

let secondHopKeys: string[] = [];
const ArticlePage = createLayout("articles.$slug")({
  kind: "derived",
  title: "Article",
  description: "",
  blocks: { before: [], after: [] },
  ...articles.pages({ by: "slug", param: "slug" }),
  toTitle: ({ page }) => page.title,
  toReact: () => (
    <ArticlePage.Item>
      {(article) => (
        <article data-id={article.id} aria-label={article.label}>
          <article.Field name="title">{(props) => <h1 {...props} />}</article.Field>
          <article.Image name="cover">{(props) => <img {...props} />}</article.Image>
          <article.Reference name="author">
            {(author) => {
              secondHopKeys = Object.keys(author);
              return <author.Field name="name">{(props) => <p {...props} />}</author.Field>;
            }}
          </article.Reference>
        </article>
      )}
    </ArticlePage.Item>
  ),
});

const app = createApp({ blocks: [], layouts: [ArticlePage], collections: [articles, authors] });

const record: AnyLayoutLoaderResult = {
  kind: "collection-item",
  collectionId: "articles",
  data: {
    id: ARTICLE_ID,
    content: {
      title: plainTextToLexicalState("Hello world"),
      slug: "hello-world",
      cover: {
        url: "https://example.test/cover.png",
        alt: "Cover",
        filename: "cover.png",
        mimeType: "image/png",
      },
      author: AUTHOR_ID,
    },
    references: {
      author: {
        id: AUTHOR_ID,
        collectionId: "authors",
        label: "Ada",
        content: { name: "Ada", portrait: null },
      },
    },
  },
};

/** Throws if anything asks the preview's editing runtime to render a field. */
const editingRuntime = {
  useSetting: () => {
    throw new Error("layout.Item asked the editing runtime for a setting");
  },
  renderBlock: () => {
    throw new Error("layout.Item asked the editing runtime for a block");
  },
  renderPrimitive: () => {
    throw new Error("layout.Item asked the editing runtime for a field");
  },
};

function render(result: AnyLayoutLoaderResult | undefined) {
  // This layout's toReact reads nothing from the page's context.
  const Component = ArticlePage._internal.toReact as React.ComponentType<{
    children: React.ReactNode;
  }>;
  return renderToStaticMarkup(
    <StudioQueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider
        value={{ projectUuid: "test" } as React.ContextType<typeof AuthContext>}
      >
        <NavigationProvider>
          <CamoxAppProvider app={app}>
            <BlockEditingRuntimeProvider runtime={editingRuntime}>
              <ArticlePage._internal.Provider layoutBlocks={{}} result={result}>
                <Component>{null}</Component>
              </ArticlePage._internal.Provider>
            </BlockEditingRuntimeProvider>
          </CamoxAppProvider>
        </NavigationProvider>
      </AuthContext.Provider>
    </StudioQueryClientProvider>,
  );
}

void test("layout.Item renders the page's record and the author it links, read-only", () => {
  const html = render(record);
  assert.match(
    html,
    /<article data-id="00000000-0000-4000-8000-000000000001" aria-label="Hello world">/,
  );
  assert.match(html, /<h1><span>Hello world<\/span><\/h1>/);
  assert.match(html, /<img [^>]*alt="Cover"/);
  assert.match(html, /<p><span>Ada<\/span><\/p>/);
  // The author is the second hop: it renders its fields but links nothing further.
  assert.ok(secondHopKeys.includes("Field"));
  assert.ok(!secondHopKeys.includes("Reference"));
  assert.ok(!secondHopKeys.includes("ReferenceList"));
  assert.doesNotMatch(html, /data-camox/);
});

void test("layout.Item renders nothing when the loader result isn't a registered record", () => {
  for (const result of [
    undefined,
    { kind: "data", data: { id: ARTICLE_ID, content: {} } },
    { ...record, collectionId: "unknown" },
  ] as AnyLayoutLoaderResult[]) {
    assert.equal(render(result), "");
  }
});
