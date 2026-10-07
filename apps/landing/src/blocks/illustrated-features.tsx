import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { InlineHeading } from "@/components/InlineHeading";
import { Pill } from "@/components/Pill";

const illustratedFeatures = createBlock({
  id: "illustrated-features",
  title: "Illustrated Features",
  description:
    "Use this block to showcase a list of product features in depth. The section opens with a pill label, a large headline and supporting description, then presents features in a 2-column grid with rounded borders. Each cell shows the title, description, and an illustration anchored to the bottom. Good fit for marketing pages that need to explain several capabilities with visual support.",
  content: (field) => ({
    pill: field.string({
      default: "Features",
      title: "Pill label",
    }),
    title: field.string({
      default: "Everything you need to ship faster.",
      title: "Title",
    }),
    description: field.string({
      default:
        "A focused toolkit that gets out of your way, so you can move from idea to launch without the usual friction.",
      title: "Description",
    }),
    items: field.repeater({
      content: (field) => ({
        title: field.string({
          default: "Built for speed.",
          title: "Feature title",
        }),
        description: field.string({
          default:
            "Skip the boilerplate and get straight to building. Our primitives are designed to be fast by default, so your product stays snappy at any scale.",
          title: "Feature description",
        }),
        illustration: field.image({
          title: "Illustration",
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Features",
      toMarkdown: (c) => [`**${c.title}** ${c.description}`, c.illustration],
    }),
  }),
  settings: (setting) => ({
    columns: setting.enum({
      default: "2",
      options: { "2": "2 columns", "3": "3 columns" },
      title: "Columns per row",
    }),
  }),
  component: IllustratedFeaturesComponent,
  toMarkdown: (c) => [c.pill, `# ${c.title}`, c.description, c.items],
});

function IllustratedFeaturesComponent() {
  const columns = illustratedFeatures.useSetting("columns");
  return (
    <BlockContainer>
      <div className="mb-16 max-w-4xl">
        <illustratedFeatures.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </illustratedFeatures.Field>
        <InlineHeading
          lead={
            <illustratedFeatures.Field name="title">
              {(props) => <span {...props} />}
            </illustratedFeatures.Field>
          }
          continuation={
            <illustratedFeatures.Field name="description">
              {(props) => <span {...props} />}
            </illustratedFeatures.Field>
          }
        />
      </div>
      <div className="border-border overflow-hidden rounded-2xl border">
        <div
          className={`bg-border grid grid-cols-1 gap-px ${columns === "3" ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
          <illustratedFeatures.Repeater name="items">
            {(item) => (
              <div className="bg-background flex h-full flex-col justify-between gap-6 px-6 pt-6">
                <div className="flex flex-col gap-2">
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
                </div>
                <item.Image name="illustration">
                  {(props) => (
                    <img
                      {...props}
                      className="border-border rounded-t-xl border-t border-r border-l"
                    />
                  )}
                </item.Image>
              </div>
            )}
          </illustratedFeatures.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { illustratedFeatures as block };
