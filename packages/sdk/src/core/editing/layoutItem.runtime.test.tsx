import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider } from "../../features/navigation/navigation";
import { previewStore, type Selection } from "../../features/preview/previewStore";
import { CamoxAppProvider } from "../../features/provider/components/CamoxAppContext";
import { initApiClient } from "../../lib/api-client";
import { AuthContext } from "../../lib/auth";
import { StudioQueryClientProvider, testDraftScope } from "../../lib/draft-scope.fixtures";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { createApp } from "../createApp";
import { createCollection } from "../createCollection";
import { createLayout, type AnyLayoutLoaderResult } from "../createLayout";
import type { ReferenceRecord } from "../lib/reference";

// Exercise the real layout, editing runtime, record scope and write queue. The harness
// substitutes only network/auth/iframe boundaries and Lexical's input surface, like the
// reference editing tests.
const editors: Array<{ onChange: (value: string) => void; externalState: unknown }> = [];
const selections: unknown[] = [];
const owner = { kind: "layout", layoutId: "articles" } as const;
const requests: Array<{ content: Record<string, unknown> }> = [];
const ARTICLE_ID = "00000000-0000-4000-8000-000000000001";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000002";
const AUTHOR: ReferenceRecord = {
  id: AUTHOR_ID,
  collectionId: "authors",
  title: "Ada",
  description: null,
  content: { name: "Ada" },
};
/** The article as the API stores it. */
let article: ReferenceRecord;
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  captureReferenceEditor: (props: (typeof editors)[number]) => editors.push(props),
  captureReferenceSelection: (selection: Selection) => {
    selections.push(selection);
    previewStore.send({ type: "selectTarget", ...owner, selection });
  },
  editReferenceRecord: async (input: (typeof requests)[number]) => {
    requests.push(input);
    article = { ...article, content: input.content, updatedAt: article.updatedAt! + 1 };
    return { id: article.id, content: article.content, createdAt: 1, updatedAt: article.updatedAt };
  },
});
initApiClient("http://localhost:8788", testDraftScope());
const previewSelectionUrl = new URL("../../features/preview/previewSelection.ts", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    // The record page's record is read from the record cache through useLatestRecord.
    const parents = ["/createEditableBlock.tsx", "/useLatestRecord.ts"];
    if (!parents.some((parent) => context.parentURL?.endsWith(parent)))
      return nextResolve(specifier, context);
    const modules: Record<string, string> = {
      "@/lib/auth": "export const useProjectUuid = () => 'test'",
      "@/features/navigation/navigation":
        "export const useLocation = () => '/'; export const useNavigate = () => () => {}",
      "../../features/preview/components/Frame":
        "export const useFrame = () => ({window: globalThis.window ?? null})",
      "../hooks/useIsEditable.ts": "export const useIsEditable = mode => mode !== 'peek'",
      "../../features/preview/previewSelection": `
        export { PreviewEditingOwnerContext } from ${JSON.stringify(previewSelectionUrl.href)};
        export const usePreviewSelection = () => globalThis.captureReferenceSelection;
        export const usePreviewTargetSelection = () => null;
      `,
      "../components/lexical/InlineLexicalEditor": `
        export const InlineLexicalEditor = props => {
          globalThis.captureReferenceEditor(props);
          return React.createElement('span', null, props.externalState);
        };
      `,
      "@/lib/queries": `
        const unused = () => ({mutationFn: () => {throw new Error('Must not mutate placement')}});
        export const blockMutations = {updateContent:unused};
        export const repeatableItemMutations = {updateContent:unused};
        export const collectionMutations = {edit: () => ({mutationFn: globalThis.editReferenceRecord})};
        export const collectionQueries = {
          record: (...parts) => ({queryKey:['camox','collections','record',...parts]}),
          records: (...parts) => ({queryKey:['camox','collections','records',...parts]}),
        };
        export const projectQueries = {getBySlug: () => ({queryKey:['project'],queryFn:()=>null})};
        export const pageQueries = {list: () => ({queryKey:['pages'],queryFn:()=>[]})};
      `,
    };
    const body = modules[specifier];
    return body
      ? { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { createEditableBlock } = await import("./createEditableBlock");
const { CompleteBlockEditingRuntimeProvider } = await import("./CompleteBlockEditingRuntime");
const { PreviewEditingOwnerContext } = await import("../../features/preview/previewSelection");

const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  content: (field) => ({ name: field.string({ default: "" }) }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
});

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({
    title: field.string({ default: "" }),
    slug: field.string({ default: "" }),
    author: field.reference(authors),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

const ArticlePage = createLayout("articles.$slug")({
  kind: "derived",
  title: "Article",
  description: "",
  blocks: { before: [], after: [] },
  ...articles.pages({ by: "slug", param: "slug" }),
  toTitle: ({ page }) => page.title,
  toReact: () => (
    <ArticlePage.Item>
      {(item) => (
        <article>
          <item.Field name="title">
            {(props) => {
              pageTitleClicks.push(props.onClickCapture as () => void);
              return <h1 {...props} />;
            }}
          </item.Field>
          <item.Reference name="author">
            {(author) => <author.Field name="name">{(props) => <p {...props} />}</author.Field>}
          </item.Reference>
        </article>
      )}
    </ArticlePage.Item>
  ),
});
let pageTitleClicks: Array<() => void> = [];

/** A block elsewhere showing the same article through a reference. */
const featured = createEditableBlock({
  id: "featured",
  title: "",
  description: "",
  content: (field) => ({ article: field.reference(articles) }),
  toMarkdown: () => [],
  toReact: () => (
    <featured.Reference name="article">
      {(item) => <item.Field name="title">{(props) => <h2 {...props} />}</item.Field>}
    </featured.Reference>
  ),
});

const app = createApp({ blocks: [], layouts: [ArticlePage], collections: [articles, authors] });

/** The envelope the record page's loader returned for the article. */
function envelope(record: ReferenceRecord): AnyLayoutLoaderResult {
  const { id, content, references, updatedAt } = record;
  return {
    kind: "collection-item",
    collectionId: "articles",
    data: { id, content, references, updatedAt },
  };
}

function setup() {
  article = {
    id: ARTICLE_ID,
    collectionId: "articles",
    title: "Hello",
    description: null,
    content: { title: "Hello", slug: "hello", author: AUTHOR_ID },
    references: { author: AUTHOR },
    updatedAt: 3,
  };
  requests.length = 0;
  selections.length = 0;
  previewStore.send({ type: "reset" });
  previewStore.send({ type: "showCanvas" });
  const client = new QueryClient();
  const loaded = envelope(article);
  /**
   * Renders the record page from the envelope its loader returned, next to the block, which
   * reads the article as the API now stores it (blocks refetch after a record edit).
   */
  const render = (result = loaded) => {
    editors.length = 0;
    pageTitleClicks = [];
    // This layout's toReact reads nothing from the page's context.
    const Component = ArticlePage._internal.toReact as React.ComponentType<{
      children: React.ReactNode;
    }>;
    return renderToStaticMarkup(
      <StudioQueryClientProvider client={client}>
        <AuthContext.Provider
          value={{ projectUuid: "test" } as React.ContextType<typeof AuthContext>}
        >
          <NavigationProvider>
            <CamoxAppProvider app={app}>
              <PreviewEditingOwnerContext value={owner}>
                <CompleteBlockEditingRuntimeProvider>
                  <ArticlePage._internal.Provider layoutBlocks={{}} result={result}>
                    <Component>{null}</Component>
                  </ArticlePage._internal.Provider>
                  <NormalizedDataProvider
                    files={[]}
                    repeatableItems={[]}
                    blocks={[{ references: { article } }]}
                  >
                    <featured._internal.Component
                      mode="site"
                      blockData={{
                        _id: "9",
                        type: "featured",
                        position: "a0",
                        content: { article: ARTICLE_ID },
                      }}
                    />
                  </NormalizedDataProvider>
                </CompleteBlockEditingRuntimeProvider>
              </PreviewEditingOwnerContext>
            </CamoxAppProvider>
          </NavigationProvider>
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  };
  return { render, client };
}

/** Mutation execution is async; no timers or network are involved. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

void test("a record page's fields are purple, select its record, and save to it", async () => {
  const { render, client } = setup();
  const html = render();
  assert.match(
    html,
    new RegExp(
      `data-camox-field-id="layout-articles__${ARTICLE_ID}"[^>]*data-camox-overlay-mode="reference"`,
    ),
  );
  assert.match(html, new RegExp(`<h1 data-camox-field-id="layout-articles__${ARTICLE_ID}__title"`));
  // The author is the record's link: a nested placement of the same page record.
  assert.match(html, new RegExp(`layout-articles__${ARTICLE_ID}__author__${AUTHOR_ID}__name`));

  pageTitleClicks[0]!();
  assert.deepEqual(selections.at(-1), {
    type: "record-field",
    layoutId: "articles",
    recordId: ARTICLE_ID,
    recordFieldName: "title",
    recordFieldType: "String",
  });

  editors[0]!.onChange("Edited");
  await settle();
  assert.deepEqual(requests, [
    {
      projectUuid: "test",
      collectionId: "articles",
      id: ARTICLE_ID,
      content: { title: "Edited", slug: "hello", author: AUTHOR_ID },
    },
  ]);
  // Both the record page, before its loader runs again, and the block show the edit.
  const updated = render();
  assert.match(updated, /<h1[^>]*><span>Edited<\/span><\/h1>/);
  assert.match(updated, /<h2[^>]*><span>Edited<\/span><\/h2>/);
  client.clear();
});

void test("an edit through a block shows on the record page at once", async () => {
  const { render, client } = setup();
  render();
  // Item title, author name, then the block's title.
  editors[2]!.onChange("From block");
  await settle();
  assert.equal(requests.length, 1);
  assert.match(render(), /<h1[^>]*><span>From block<\/span><\/h1>/);
  // The page's next edit saves over the content the block's edit produced.
  editors[0]!.onChange("Then from page");
  await settle();
  assert.equal(requests.length, 2);
  assert.match(render(), /<h1[^>]*><span>Then from page<\/span><\/h1>/);
  client.clear();
});
