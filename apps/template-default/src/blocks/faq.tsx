import { Type, createBlock } from "camox/createBlock";

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
  content: {
    items: Type.Repeater({
      content: {
        question: Type.String({
          default: "How do I make this website my own?",
          title: "Question",
        }),
        answer: Type.String({
          default:
            "Tell your coding agent what you're building, who it's for, and the style you want. Your agent has access to the Camox skill and will use it to create your own blocks, update your content, and manage your pages.",
          title: "Answer",
        }),
      },
      minItems: 3,
      maxItems: Infinity,
      title: "Questions",
      toMarkdown: (c) => [`Q: ${c.question}`, `A: ${c.answer}`],
    }),
  },
  component: FaqComponent,
  toMarkdown: (c) => [c.items],
});

function FaqComponent() {
  return (
    <section className="py-12 sm:py-16 md:py-20">
      <div className="mx-auto max-w-2xl px-4">
        <Accordion>
          <faq.Repeater name="items">
            {(item, index) => (
              <AccordionItem value={index}>
                <AccordionTrigger className="items-center text-lg">
                  <item.Field name="question">{(props) => <span {...props} />}</item.Field>
                </AccordionTrigger>
                <AccordionContent>
                  <item.Field name="answer">
                    {(props) => <p {...props} className="text-muted-foreground text-base" />}
                  </item.Field>
                </AccordionContent>
              </AccordionItem>
            )}
          </faq.Repeater>
        </Accordion>
      </div>
    </section>
  );
}

export { faq as block };
