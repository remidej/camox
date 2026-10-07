import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { InlineHeading } from "@/components/InlineHeading";
import { Pill } from "@/components/Pill";

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
    <BlockContainer>
      <div className="flex flex-col gap-12 sm:flex-row">
        <div className="sm:mt-3 sm:w-3/12 sm:shrink-0">
          <largeParagraphsGroup.Field name="title">
            {(props) => <Pill {...props} />}
          </largeParagraphsGroup.Field>
        </div>
        <div className="flex flex-1 flex-col gap-12">
          <largeParagraphsGroup.Repeater name="items">
            {(item) => (
              <InlineHeading
                lead={<item.Field name="title">{(props) => <span {...props} />}</item.Field>}
                continuation={
                  <item.Field name="description">{(props) => <span {...props} />}</item.Field>
                }
              />
            )}
          </largeParagraphsGroup.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { largeParagraphsGroup as block };
