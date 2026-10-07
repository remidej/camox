import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";

const article = createBlock({
  id: "article",
  title: "Article",
  description:
    "Use this block for long-form, text-first pages such as legal documents, policies, guides, and blog articles. Give the page a clear title and introduction, then organize the body into concise titled sections. Keep paragraphs readable and use inline formatting or links where helpful.",
  content: (field) => ({
    meta: field.string({
      default: "Last updated recently",
      title: "Metadata",
    }),
    title: field.string({
      default: "Article title",
      title: "Title",
    }),
    introduction: field.string({
      default: "A short introduction that explains what this page covers.",
      title: "Introduction",
    }),
    sections: field.repeater({
      content: (field) => ({
        title: field.string({
          default: "Section title",
          title: "Title",
        }),
        body: field.string({
          default: "Write the section content here.",
          title: "Body",
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Sections",
      toMarkdown: (c) => [`## ${c.title}`, c.body],
    }),
  }),
  component: ArticleComponent,
  toMarkdown: (c) => [c.meta, `# ${c.title}`, c.introduction, c.sections],
});

function ArticleComponent() {
  return (
    <BlockContainer>
      <article className="mx-auto max-w-3xl px-4">
        <header className="border-border border-b pb-10 sm:pb-12">
          <article.Field name="meta">
            {(props) => (
              <p
                {...props}
                className="text-primary mb-5 text-sm font-semibold tracking-wide uppercase"
              />
            )}
          </article.Field>
          <article.Field name="title">
            {(props) => (
              <h1
                {...props}
                className="text-foreground text-4xl leading-tight font-semibold tracking-tight sm:text-5xl"
              />
            )}
          </article.Field>
          <article.Field name="introduction">
            {(props) => (
              <p
                {...props}
                className="text-muted-foreground mt-6 text-lg leading-relaxed sm:text-xl"
              />
            )}
          </article.Field>
        </header>

        <div className="flex flex-col gap-10 pt-10 sm:gap-12 sm:pt-12">
          <article.Repeater name="sections">
            {(section) => (
              <section className="scroll-mt-24">
                <section.Field name="title">
                  {(props) => (
                    <h2
                      {...props}
                      className="text-foreground text-xl font-semibold tracking-tight sm:text-2xl"
                    />
                  )}
                </section.Field>
                <section.Field name="body">
                  {(props) => (
                    <p
                      {...props}
                      className="text-foreground mt-3 text-base leading-7 whitespace-pre-line sm:text-lg sm:leading-8"
                    />
                  )}
                </section.Field>
              </section>
            )}
          </article.Repeater>
        </div>
      </article>
    </BlockContainer>
  );
}

export { article as block };
