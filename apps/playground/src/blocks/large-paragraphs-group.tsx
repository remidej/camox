import { createBlock } from "camox/createBlock";

const largeParagraphsGroup = createBlock({
  id: "large-paragraphs-group",
  title: "Large Paragraphs Group",
  description:
    "Use this block to present a short section label followed by one or more statement paragraphs. Each paragraph pairs a bold lead sentence with a muted continuation displayed inline on the same line. Good fit for marketing narratives, value propositions, or manifesto-style sections where copy should feel editorial and text-forward.",
  content: (field) => ({
    title: field.string({
      default: "Why choose us",
      title: "Title",
    }),
    items: field.repeater({
      content: (field) => ({
        title: field.string({
          default: "A new kind of tool.",
          title: "Lead sentence",
        }),
        description: field.string({
          default:
            "Our tool really isn't like the others. In fact it's quite different. Try it and you'll see for yourself. We think you'll love it.",
          title: "Continuation",
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Paragraphs",
      toMarkdown: (c) => [`**${c.title}** ${c.description}`],
    }),
  }),
  component: LargeParagraphsGroupComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.items],
});

function LargeParagraphsGroupComponent() {
  return (
    <section className="container mx-auto py-12 sm:py-16">
      <div className="container mx-auto px-4">
        <largeParagraphsGroup.Field name="title">
          {(props) => <h3 {...props} className="mb-4 sm:mb-6" />}
        </largeParagraphsGroup.Field>
        <div className="flex max-w-4xl flex-col gap-8 sm:gap-12">
          <largeParagraphsGroup.Repeater name="items">
            {(item) => (
              <p className="text-foreground text-xl leading-tight font-semibold tracking-tight sm:text-3xl md:text-4xl">
                <item.Field name="title">{(props) => <span {...props} />}</item.Field>
                <item.Field name="description">
                  {(props) => <span {...props} className="text-muted-foreground" />}
                </item.Field>
              </p>
            )}
          </largeParagraphsGroup.Repeater>
        </div>
      </div>
    </section>
  );
}

export { largeParagraphsGroup as block };
