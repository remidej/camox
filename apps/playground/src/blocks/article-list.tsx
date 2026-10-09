import { createBlock } from "camox/createBlock";

import { collection as articles } from "../collections/articles";

const articleList = createBlock({
  id: "article-list",
  title: "Article list",
  description:
    "List every published article alphabetically by title, each with its excerpt. Use it as an index of all articles. The list maintains itself: published articles appear in title order without anyone picking them.",
  content: (field) => ({
    title: field.string({ default: "All articles", title: "Title" }),
    articles: field.referenceList(articles, {
      title: "Articles",
      query: { orderBy: { title: "asc" } },
      toMarkdown: (article) => [`**${article.title}**: ${article.excerpt}`],
    }),
  }),
  component: ArticleListComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.articles],
});

function ArticleListComponent() {
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto max-w-3xl px-4">
        <articleList.Field name="title">
          {(props) => <h2 {...props} className="text-foreground mb-8 text-3xl font-semibold" />}
        </articleList.Field>
        <ul className="divide-border divide-y">
          <articleList.ReferenceList name="articles">
            {(article) => (
              <li className="py-4">
                <article.Field name="title">
                  {(props) => <h3 {...props} className="text-foreground font-medium" />}
                </article.Field>
                <article.Field name="excerpt">
                  {(props) => <p {...props} className="text-muted-foreground mt-1 text-sm" />}
                </article.Field>
              </li>
            )}
          </articleList.ReferenceList>
        </ul>
      </div>
    </section>
  );
}

export { articleList as block };
