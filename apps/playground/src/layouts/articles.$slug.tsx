import { createLayout } from "camox/createLayout";

import { block as backToArticlesBlock } from "../blocks/back-to-articles";
import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import { collection as articles } from "../collections/articles";

/** A record page: each article is rendered at `/articles/<its slug>`. */
export const Layout = createLayout("articles.$slug")({
  kind: "derived",
  title: "Article",
  description: "One article of the Articles collection, found by its slug.",
  blocks: { before: [navbarBlock, backToArticlesBlock], after: [footerBlock] },
  ...articles.pages({ by: "slug", param: "slug" }),
  buildMetaTitle: ({ item, projectName }) => `${item.title} | ${projectName}`,
  buildMetaDescription: ({ item }) => item.excerpt || undefined,
  toMarkdown: ({ item }) => [
    `# ${item.title}`,
    `By ${item.author.name}`,
    item.cover,
    item.excerpt,
    item.body,
  ],
  component: ArticlePage,
});

function ArticlePage() {
  return (
    <div className="bg-canvas text-ink flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-12 sm:px-8">
        <Layout.Item>
          {(article) => (
            <article>
              <article.Field name="title">
                {(props) => <h1 {...props} className="mt-6 text-4xl font-bold" />}
              </article.Field>
              <article.Reference name="author">
                {(author) => (
                  <div className="mt-4 flex items-center gap-3">
                    <author.Image name="portrait">
                      {(props) => <img {...props} className="size-10 rounded-full object-cover" />}
                    </author.Image>
                    <author.Field name="name">
                      {(props) => <p {...props} className="text-sm font-medium" />}
                    </author.Field>
                  </div>
                )}
              </article.Reference>
              <article.Field name="excerpt">
                {(props) => <p {...props} className="text-ink-muted mt-4 text-lg" />}
              </article.Field>
              <article.Image name="cover">
                {(props) => <img {...props} className="mt-8 w-full rounded-lg object-cover" />}
              </article.Image>
              <article.Field name="body">
                {(props) => <p {...props} className="mt-8 leading-relaxed" />}
              </article.Field>
            </article>
          )}
        </Layout.Item>
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
