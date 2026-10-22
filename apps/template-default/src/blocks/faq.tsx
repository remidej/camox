import { createBlock } from "camox/createBlock";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { colorSchemeSetting, Section } from "@/components/ui/section";

const faq = createBlock({
  id: "faq",
  title: "FAQ",
  description:
    "Use this block to answer common questions about the product, pricing, or company. Place it near the bottom of a page to address objections before a conversion section.",
  content: (field) => ({
    items: field.repeater({
      content: (field) => ({
        question: field.string({
          default: "How do I make this website my own?",
          title: "Question",
        }),
        answer: field.string({
          default:
            "Tell your coding agent what you're building, who it's for, and the style you want. Your agent has access to the Camox skill and will use it to create your own blocks, update your content, and manage your pages.",
          title: "Answer",
        }),
      }),
      minItems: 3,
      maxItems: Infinity,
      title: "Questions",
      toTitle: ({ content }) => content.question,
      toMarkdown: ({ content }) => [`Q: ${content.question}`, `A: ${content.answer}`],
    }),
  }),
  settings: (setting) => ({
    scheme: colorSchemeSetting(setting, "light"),
  }),
  toReact: FaqComponent,
  toTitle: () => "FAQ",
  toMarkdown: ({ content }) => [content.items],
});

function FaqComponent() {
  const scheme = faq.useSetting("scheme");

  return (
    <Section scheme={scheme}>
      <Container className="max-w-text">
        <Accordion>
          <faq.Repeater name="items">
            {(item) => (
              <AccordionItem>
                <AccordionTrigger className="text-title items-center">
                  <item.Field name="question">{(props) => <span {...props} />}</item.Field>
                </AccordionTrigger>
                <AccordionContent>
                  <item.Field name="answer">
                    {(props) => <p {...props} className="text-ink-muted text-base" />}
                  </item.Field>
                </AccordionContent>
              </AccordionItem>
            )}
          </faq.Repeater>
        </Accordion>
      </Container>
    </Section>
  );
}

export { faq as block };
