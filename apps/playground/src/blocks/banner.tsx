import { createBlock } from "camox/createBlock";

const banner = createBlock({
  id: "banner",
  title: "Banner",
  description: "Describe when the AI should use this block.",
  layoutOnly: true,
  content: (field) => ({
    title: field.string({ default: "Title" }),
  }),
  toReact: BannerComponent,
  toMarkdown: ({ content }) => [content.title],
});

function BannerComponent() {
  return (
    <section>
      <banner.Field name="title">{(props) => <h1 {...props} />}</banner.Field>
    </section>
  );
}

export { banner as block };
