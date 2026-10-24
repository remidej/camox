import { createBlock } from "camox/createBlock";

import { Container } from "@/components/ui/container";
import { colorSchemeSetting, Section } from "@/components/ui/section";
import { Tabs, TabsContent, TabsItem, TabsTrigger } from "@/components/ui/tabs";

const featureTabs = createBlock({
  id: "feature-tabs",
  title: "Feature tabs",
  description:
    "Use this block to present a few features, use cases or audiences side by side, one tab each, so visitors pick the one that matters to them. Keep tab labels to one or two words.",
  content: (field) => ({
    title: field.string({
      default: "Everything you need, in one place",
      title: "Title",
    }),
    tabs: field.repeater({
      content: (field) => ({
        label: field.string({
          default: "Feature",
          maxLength: 32,
          title: "Label",
        }),
        heading: field.string({
          default: "A feature worth its own tab",
          title: "Heading",
        }),
        description: field.string({
          default:
            "Describe what this feature does and who it helps. Visitors open one tab at a time, so each tab can go into a bit more detail.",
          title: "Description",
        }),
      }),
      minItems: 2,
      maxItems: 6,
      title: "Tabs",
      toTitle: ({ content }) => content.label,
      toMarkdown: ({ content }) => [`## ${content.label}: ${content.heading}`, content.description],
    }),
  }),
  settings: (setting) => ({
    scheme: colorSchemeSetting(setting, "light"),
  }),
  toReact: FeatureTabsComponent,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [`# ${content.title}`, content.tabs],
});

function FeatureTabsComponent() {
  const scheme = featureTabs.useSetting("scheme");

  return (
    <Section scheme={scheme}>
      <Container className="max-w-text">
        <featureTabs.Field name="title">
          {(props) => <h2 {...props} className="text-heading mb-10" />}
        </featureTabs.Field>
        <Tabs>
          <featureTabs.Repeater name="tabs">
            {(item, index) => (
              <TabsItem open={index === 0}>
                <TabsTrigger>
                  <item.Field name="label">{(props) => <span {...props} />}</item.Field>
                </TabsTrigger>
                <TabsContent>
                  <item.Field name="heading">
                    {(props) => <h3 {...props} className="text-title mb-3" />}
                  </item.Field>
                  <item.Field name="description">
                    {(props) => <p {...props} className="text-ink-muted text-base" />}
                  </item.Field>
                </TabsContent>
              </TabsItem>
            )}
          </featureTabs.Repeater>
        </Tabs>
      </Container>
    </Section>
  );
}

export { featureTabs as block };
