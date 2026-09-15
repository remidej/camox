import { Type, createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { Pill } from "@/components/Pill";

const paragraphGrid = createBlock({
  id: "paragraph-grid",
  title: "Paragraph Grid",
  description:
    "Use this block for a 'why us' section about avoiding the operational pitfalls of agent-built websites. Open with a concise promise, follow with four problem-led benefits, and close with a synthesis banner. Each item should name a concrete failure the product prevents, then explain how it prevents it. Emphasize the key failure term with inline italics. Keep claims grounded in product behavior and do not criticize named competitors.",
  content: {
    pill: Type.String({
      default: "Why us",
      title: "Pill label",
    }),
    title: Type.String({
      default: "Agent-built websites, without the usual pitfalls.",
      title: "Section heading",
    }),
    paragraphs: Type.Repeater({
      content: {
        title: Type.String({
          default: "Pages don't *drift*.",
          title: "Problem prevented",
        }),
        description: Type.String({
          default: "Shared blocks keep your site consistent as it grows.",
          title: "How it works",
        }),
      },
      minItems: 4,
      maxItems: 4,
      title: "Problem-led benefits",
      toMarkdown: (c) => [`**${c.title}** ${c.description}`],
    }),
    bannerText: Type.String({
      default: "Camox combines the *speed* of agents with the *structure* of a CMS.",
      title: "Banner text",
    }),
  },
  component: ParagraphGridComponent,
  toMarkdown: (c) => [c.pill, `# ${c.title}`, c.paragraphs, `**${c.bannerText}**`],
});

function ParagraphGridComponent() {
  return (
    <BlockContainer>
      <div className="mb-16 max-w-4xl">
        <paragraphGrid.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </paragraphGrid.Field>
        <paragraphGrid.Field name="title">
          {(props) => (
            <h2
              {...props}
              className="text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
            />
          )}
        </paragraphGrid.Field>
      </div>

      <div className="bg-popover mb-12 rounded-2xl px-5 py-2 sm:px-8 sm:py-3">
        <paragraphGrid.Repeater name="paragraphs">
          {(item) => (
            <article className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-3 py-5 sm:grid-cols-[1.5rem_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-x-4 sm:py-7">
              <span
                aria-hidden="true"
                className="text-primary font-mono text-2xl leading-6 font-semibold"
              >
                &gt;
              </span>
              <p className="text-foreground text-xl leading-tight font-semibold tracking-tight sm:text-2xl">
                <item.Field
                  name="title"
                  textStyle={({ italic }) => ({
                    className: italic ? "text-primary not-italic" : undefined,
                    style: italic ? { fontStyle: "normal" } : undefined,
                  })}
                >
                  {(props) => <span {...props} />}
                </item.Field>
              </p>
              <item.Field name="description">
                {(props) => (
                  <p
                    {...props}
                    className="text-muted-foreground col-start-2 text-base leading-relaxed sm:col-start-auto sm:text-lg"
                  />
                )}
              </item.Field>
            </article>
          )}
        </paragraphGrid.Repeater>
      </div>

      <div className="bg-primary text-primary-foreground rounded-2xl p-8 sm:p-12">
        <paragraphGrid.Field name="bannerText">
          {(props) => (
            <p
              {...props}
              className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl"
            />
          )}
        </paragraphGrid.Field>
      </div>
    </BlockContainer>
  );
}

export { paragraphGrid as block };
