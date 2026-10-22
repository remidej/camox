import { createBlock } from "camox/createBlock";
import { useLocalizedHref } from "camox/navigation";

const backToArticles = createBlock({
  id: "back-to-articles",
  title: "Back to articles",
  layoutOnly: true,
  description: "A link back to the articles index, above an article.",
  content: (field) => ({
    text: field.string({ title: "Text", default: "← All articles" }),
  }),
  toReact: BackToArticlesComponent,
  toTitle: ({ content }) => content.text,
  toMarkdown: ({ content }) => [`[${content.text}](/articles)`],
});

function BackToArticlesComponent() {
  const localized = useLocalizedHref();
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-12 sm:px-8">
      <backToArticles.Field name="text">
        {(props) => (
          <a
            {...props}
            href={localized("/articles")}
            className="text-ink-muted hover:text-ink text-sm"
          />
        )}
      </backToArticles.Field>
    </div>
  );
}

export { backToArticles as block };
