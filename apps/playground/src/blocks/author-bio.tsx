import { createBlock } from "camox/createBlock";

import { collection as authors } from "../collections/authors";

const authorBio = createBlock({
  id: "author-bio",
  title: "Author bio",
  description:
    "Introduce an author with their portrait, bio and the articles they wrote. Place it at the end of an article or on an about page. The author and their articles are shared Authors and Articles items, so edits show up everywhere they appear.",
  content: (field) => ({
    author: field.reference(authors, { title: "Author" }),
  }),
  component: AuthorBioComponent,
  toMarkdown: (c) => [`## ${c.author.name}`, c.author.bio, c.author.articles],
});

function AuthorBioComponent() {
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto max-w-3xl px-4">
        <authorBio.Reference name="author">
          {(author) => (
            <div className="flex flex-col gap-6 sm:flex-row">
              <author.Image name="portrait">
                {(props) => <img {...props} className="size-24 rounded-full object-cover" />}
              </author.Image>
              <div className="flex-1">
                <author.Field name="name">
                  {(props) => <h2 {...props} className="text-foreground text-2xl font-semibold" />}
                </author.Field>
                <author.Field name="bio">
                  {(props) => <p {...props} className="text-muted-foreground mt-2" />}
                </author.Field>
                <ul className="mt-6 space-y-3">
                  <author.ReferenceList name="articles">
                    {(article) => (
                      <li>
                        <article.Field name="title">
                          {(props) => <h3 {...props} className="text-foreground font-medium" />}
                        </article.Field>
                        <article.Field name="excerpt">
                          {(props) => <p {...props} className="text-muted-foreground text-sm" />}
                        </article.Field>
                      </li>
                    )}
                  </author.ReferenceList>
                </ul>
              </div>
            </div>
          )}
        </authorBio.Reference>
      </div>
    </section>
  );
}

export { authorBio as block };
