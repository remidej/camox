import { createBlock } from "camox/createBlock";

import { collection as articles } from "../collections/articles";

const recentArticles = createBlock({
  id: "recent-articles",
  title: "Recent articles",
  description:
    "Show the three most recently published articles, newest first, as cards with a cover, title and excerpt. Place it on a home or landing page to point visitors to fresh content. The list maintains itself: publishing an article adds it, without editing or republishing this block.",
  content: (field) => ({
    title: field.string({ default: "Latest articles", title: "Title" }),
    articles: field.referenceList(articles, {
      title: "Articles",
      query: { orderBy: { publishedAt: "desc" }, limit: 3 },
      toMarkdown: (article) => [`### ${article.title}`, article.excerpt],
    }),
  }),
  component: RecentArticlesComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.articles],
});

function RecentArticlesComponent() {
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4">
        <recentArticles.Field name="title">
          {(props) => <h2 {...props} className="text-foreground mb-8 text-3xl font-semibold" />}
        </recentArticles.Field>
        <ul className="grid gap-8 md:grid-cols-3">
          <recentArticles.ReferenceList name="articles">
            {(article) => (
              <li className="flex flex-col gap-3">
                <article.Image name="cover">
                  {(props) => (
                    <img {...props} className="aspect-video w-full rounded-lg object-cover" />
                  )}
                </article.Image>
                <article.Field name="title">
                  {(props) => <h3 {...props} className="text-foreground text-lg font-medium" />}
                </article.Field>
                <article.Field name="excerpt">
                  {(props) => <p {...props} className="text-muted-foreground text-sm" />}
                </article.Field>
              </li>
            )}
          </recentArticles.ReferenceList>
        </ul>
      </div>
    </section>
  );
}

export { recentArticles as block };
