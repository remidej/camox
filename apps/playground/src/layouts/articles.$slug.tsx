import { createLayout } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import { collection as articles } from "../collections/articles";

/** A record page: each article is rendered at `/articles/<its slug>`. */
export const Layout = createLayout("articles.$slug")({
  kind: "derived",
  title: "Article",
  description: "One article of the Articles collection, found by its slug.",
  blocks: { before: [navbarBlock], after: [footerBlock] },
  ...articles.pages({ by: "slug", param: "slug" }),
  buildMetaTitle: ({ pageMetaTitle, projectName }) => `${pageMetaTitle} | ${projectName}`,
  component: ArticlePage,
});

/** Edited String fields are stored as rich-text state; this read-only page shows their text. */
function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";
  const node = value as { text?: unknown; root?: unknown; children?: unknown };
  if (typeof node.text === "string") return node.text;
  if (node.root) return plainText(node.root);
  if (!Array.isArray(node.children)) return "";
  return node.children.map(plainText).join("");
}

function ArticlePage() {
  const { content } = Layout.useData();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8">
        <a href="/articles" className="text-muted-foreground hover:text-foreground text-sm">
          ← All articles
        </a>
        <h1 className="mt-6 text-4xl font-bold">{plainText(content.title)}</h1>
        <p className="text-muted-foreground mt-4 text-lg">{plainText(content.excerpt)}</p>
        <p className="mt-8 leading-relaxed">{plainText(content.body)}</p>
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
