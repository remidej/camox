import { createBlock } from "camox/createBlock";
import { CircleCheck } from "lucide-react";

import { BlockContainer } from "@/components/BlockContainer";
import { CaretLink } from "@/components/CaretLink";
import { Pill } from "@/components/Pill";

const keyPrinciples = createBlock({
  id: "key-principles",
  title: "Key Principles",
  description:
    "Use this block to highlight a small set of guiding principles, pillars, or differentiators that define a product or company. The section opens with a pill label and a large headline, then lists each principle in a card with a check icon, a title, a description, and an optional learn-more link. Good fit for 'how we think', 'core values', protocols, or product principle sections. Works best with 3 items so the grid is balanced.",
  content: (field) => ({
    pill: field.string({
      default: "Principles",
      title: "Pill label",
    }),
    title: field.string({
      default: "Built around a few key principles.",
      title: "Title",
    }),
    items: field.repeater({
      content: (field) => ({
        title: field.string({
          default: "Context Server",
          title: "Title",
        }),
        description: field.string({
          default:
            "Intelligent tools that replace built-in file reads, shell commands, and code search. Understands your intent and tracks context window pressure autonomously.",
          title: "Description",
        }),
        link: field.link({
          default: { text: "Learn more", href: "/", newTab: false },
          title: "Link",
        }),
      }),
      settings: (setting) => ({
        showLink: setting.boolean({
          default: false,
          title: "Show link",
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Principles",
      toMarkdown: (c, s) => [`### ${c.title}`, c.description, s.showLink(c.link)],
    }),
  }),
  component: KeyPrinciplesComponent,
  toMarkdown: (c) => [c.pill, `## ${c.title}`, c.items],
});

function KeyPrinciplesComponent() {
  return (
    <BlockContainer>
      <div className="mb-12 max-w-4xl">
        <keyPrinciples.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </keyPrinciples.Field>
        <keyPrinciples.Field name="title">
          {(props) => (
            <h2
              {...props}
              className="text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
            />
          )}
        </keyPrinciples.Field>
      </div>
      <div className="border-border w-full overflow-hidden rounded-2xl border">
        <div className="bg-border grid grid-cols-1 gap-px md:grid-cols-3">
          <keyPrinciples.Repeater name="items">
            {(item) => {
              const showLink = item.useSetting("showLink");
              return (
                <div className="bg-popover flex h-full flex-col gap-4 p-6 sm:p-8">
                  <CircleCheck aria-hidden className="text-muted-foreground size-5" />
                  <item.Field name="title">
                    {(props) => (
                      <h3
                        {...props}
                        className="text-foreground text-xl font-semibold tracking-tight"
                      />
                    )}
                  </item.Field>
                  <item.Field name="description">
                    {(props) => <p {...props} className="text-muted-foreground text-base" />}
                  </item.Field>
                  {showLink && (
                    <div className="mt-auto pt-4">
                      <item.Link name="link">{(props) => <CaretLink {...props} />}</item.Link>
                    </div>
                  )}
                </div>
              );
            }}
          </keyPrinciples.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { keyPrinciples as block };
