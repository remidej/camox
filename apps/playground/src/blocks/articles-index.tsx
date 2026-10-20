import { createBlock } from "camox/createBlock";
import { useLocalizedHref } from "camox/navigation";

import { collection as articles } from "../collections/articles";

const articlesIndex = createBlock({
  id: "articles-index",
  title: "Articles index",
  layoutOnly: true,
  description:
    "The articles index page's list: every published article alphabetically by title, each linking to its own article page.",
  content: (field) => ({
    title: field.string({ default: "Articles", title: "Title" }),
    articles: field.referenceList(articles, {
      title: "Articles",
      query: { orderBy: { title: "asc" } },
      toMarkdown: (article) => [
        `- [${article.title}](/articles/${article.slug}): ${article.excerpt}`,
      ],
    }),
  }),
  component: ArticlesIndexComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.articles],
});

function ArticlesIndexComponent() {
  const localized = useLocalizedHref();
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto max-w-3xl px-4">
        <articlesIndex.Field name="title">
          {(props) => <h1 {...props} className="text-foreground mb-8 text-4xl font-bold" />}
        </articlesIndex.Field>
        <ul className="divide-border divide-y">
          <articlesIndex.ReferenceList name="articles">
            {(article) => (
              <li className="py-4">
                {/* The record page's URL is built from the slug in code, not stored as a link. */}
                <article.Field name="slug">
                  {(_props, { text: slug }) => (
                    <a href={localized(`/articles/${slug}`)} className="group block">
                      <article.Field name="title">
                        {(props) => (
                          <h2
                            {...props}
                            className="text-foreground font-medium group-hover:underline"
                          />
                        )}
                      </article.Field>
                      <article.Field name="excerpt">
                        {(props) => <p {...props} className="text-muted-foreground mt-1 text-sm" />}
                      </article.Field>
                    </a>
                  )}
                </article.Field>
              </li>
            )}
          </articlesIndex.ReferenceList>
        </ul>
      </div>
    </section>
  );
}

export { articlesIndex as block };
