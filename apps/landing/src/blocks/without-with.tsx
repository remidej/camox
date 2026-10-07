import { createBlock } from "camox/createBlock";
import { Check, X } from "lucide-react";

import { BlockContainer } from "@/components/BlockContainer";
import { InlineHeading } from "@/components/InlineHeading";
import { Pill } from "@/components/Pill";

const withoutWith = createBlock({
  id: "without-with",
  title: "Without / With",
  description:
    "Use this comparison block to contrast recurring problems with the better outcomes, capabilities, or behaviors that address them. Each row pairs one concise 'without' statement with one directly corresponding 'with' statement. Keep both sides parallel, concrete, and similar in length.",
  content: (field) => ({
    pill: field.string({
      default: "Compare",
      title: "Pill label",
    }),
    title: field.string({
      default: "See the difference.",
      title: "Title",
    }),
    description: field.string({
      default: "Compare the usual approach with a better way forward.",
      title: "Description",
    }),
    withoutLabel: field.string({
      default: "Without",
      title: "Without column label",
    }),
    withLabel: field.string({
      default: "With",
      title: "With column label",
    }),
    comparisons: field.repeater({
      content: (field) => ({
        without: field.string({
          default: "A disconnected workflow",
          title: "Without",
        }),
        with: field.string({
          default: "One connected workflow",
          title: "With",
        }),
      }),
      minItems: 2,
      maxItems: 8,
      title: "Comparisons",
      toMarkdown: (c) => [`**Without:** ${c.without}\n**With:** ${c.with}`],
    }),
  }),
  component: WithoutWithComponent,
  toMarkdown: (c) => [
    c.pill,
    `## ${c.title}`,
    c.description,
    `### ${c.withoutLabel} / ${c.withLabel}`,
    c.comparisons,
  ],
});

function WithoutWithComponent() {
  return (
    <BlockContainer>
      <div className="max-w-4xl">
        <withoutWith.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </withoutWith.Field>
        <InlineHeading
          lead={
            <withoutWith.Field name="title">{(props) => <span {...props} />}</withoutWith.Field>
          }
          continuation={
            <withoutWith.Field name="description">
              {(props) => <span {...props} />}
            </withoutWith.Field>
          }
        />
      </div>

      <div className="border-border mt-12 overflow-hidden rounded-2xl border sm:mt-16">
        <div className="border-border grid grid-cols-2 border-b">
          <div className="bg-popover px-5 py-4 sm:px-6">
            <withoutWith.Field name="withoutLabel">
              {(props) => (
                <p
                  {...props}
                  className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase"
                />
              )}
            </withoutWith.Field>
          </div>
          <div className="border-border bg-popover border-l px-5 py-4 sm:px-6">
            <withoutWith.Field name="withLabel">
              {(props) => (
                <p
                  {...props}
                  className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase"
                />
              )}
            </withoutWith.Field>
          </div>
        </div>
        <div className="bg-border grid gap-px">
          <withoutWith.Repeater name="comparisons">
            {(item) => (
              <article className="grid grid-cols-2">
                <div className="bg-background flex min-w-0 items-center gap-3 p-5 sm:p-6">
                  <span className="bg-destructive/10 flex size-7 shrink-0 items-center justify-center rounded-full">
                    <X aria-hidden className="text-destructive size-4 stroke-[2.5]" />
                  </span>
                  <item.Field name="without">
                    {(props) => (
                      <p {...props} className="text-foreground text-base font-medium sm:text-lg" />
                    )}
                  </item.Field>
                </div>

                <div className="border-border bg-background flex min-w-0 items-center gap-3 border-l p-5 sm:p-6">
                  <span className="bg-primary/10 flex size-7 shrink-0 items-center justify-center rounded-full">
                    <Check aria-hidden className="text-primary size-4 stroke-[2.5]" />
                  </span>
                  <item.Field name="with">
                    {(props) => (
                      <p {...props} className="text-foreground text-base font-medium sm:text-lg" />
                    )}
                  </item.Field>
                </div>
              </article>
            )}
          </withoutWith.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { withoutWith as block };
