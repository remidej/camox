import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faq = createBlock({
  id: "faq",
  title: "FAQ",
  description:
    "Use this block to answer common questions about the product, pricing, or company. Place it near the bottom of a page to address objections before a conversion section.",
  content: (field) => ({
    items: field.repeater({
      content: (field) => ({
        question: field.string({
          default: "What is your refund policy?",
          title: "Question",
        }),
        answer: field.string({
          default:
            "We offer a 30-day money-back guarantee. If you're not satisfied, contact support and we'll process your refund right away.",
          title: "Answer",
        }),
      }),
      minItems: 3,
      maxItems: Infinity,
      title: "Questions",
      toTitle: ({ content }) => content.question,
      toMarkdown: (c) => [`Q: ${c.question}`, `A: ${c.answer}`],
    }),
  }),
  component: FaqComponent,
  toTitle: () => "FAQ",
  toMarkdown: (c) => [c.items],
});

function FaqComponent() {
  return (
    <BlockContainer>
      <div className="max-w-text mx-auto px-4">
        <Accordion>
          <faq.Repeater name="items">
            {(item) => (
              <AccordionItem>
                <AccordionTrigger className="items-center text-lg">
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
      </div>
    </BlockContainer>
  );
}

export { faq as block };
