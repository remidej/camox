import { createBlock } from "camox/createBlock";

import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const statistics = createBlock({
  id: "statistics",
  title: "Statistics",
  description:
    'Use this block to showcase key metrics, achievements, or performance indicators. Ideal for displaying platform statistics, product metrics, company milestones, or any quantifiable data. Place this block in sections where you want to build credibility or highlight important numbers. Each statistic should have a number (can include units like "M+", "%", "ms") and a descriptive label.',
  content: (field) => ({
    title: field.string({
      default: "Platform performance",
      maxLength: 30,
      title: "Title",
    }),
    subtitle: field.string({
      default: "Built for modern web development",
      title: "Subtitle",
    }),
    description: field.string({
      default:
        "Camox empowers developers to build and deploy websites with unprecedented speed and flexibility. Our platform handles millions of page views and serves content globally with enterprise-grade reliability.",
      title: "Description",
    }),
    statistics: field.repeater({
      content: (field) => ({
        icon: field.icon({
          title: "Icon",
          default: "lucide:zap",
        }),
        number: field.string({
          default: "100M+",
          maxLength: 7,
          title: "Number",
        }),
        label: field.string({
          default: "pages served monthly across all projects.",
          title: "Label",
        }),
      }),
      settings: (setting) => ({
        accent: setting.enum({
          default: "brand",
          options: {
            brand: "Brand",
            ink: "Ink",
            muted: "Muted",
          },
          title: "Accent",
        }),
      }),
      minItems: 4,
      maxItems: 8,
      title: "Statistics",
      toMarkdown: ({ content, settings }) => [
        settings.accent("brand", `**${content.number}** — ${content.label}`),
      ],
    }),
  }),
  toReact: StatisticsComponent,
  toMarkdown: ({ content }) => [`## ${content.subtitle}`, content.description, content.statistics],
});

// The bar beside each statistic: its accent color, fading out downward.
const accentBarClasses: Record<string, string> = {
  brand: "from-brand to-brand/10",
  ink: "from-ink to-ink/10",
  muted: "from-ink-muted to-ink-muted/10",
};

function StatisticsComponent() {
  return (
    <Section scheme="dark">
      <Container>
        <div className="mx-auto max-w-6xl">
          {/* Header section */}
          <div className="mb-16">
            <statistics.Field name="title">
              {(props) => <p {...props} className="text-eyebrow text-brand mb-4 uppercase" />}
            </statistics.Field>
            <statistics.Field name="subtitle">
              {(props) => <h2 {...props} className="text-heading mb-6" />}
            </statistics.Field>
            <statistics.Field name="description">
              {(props) => <p {...props} className="text-lead text-ink-muted max-w-3xl" />}
            </statistics.Field>
          </div>

          {/* Statistics grid layout */}
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            <statistics.Repeater name="statistics">
              {(stat) => {
                const accent = stat.useSetting("accent");
                return (
                  <div className="flex gap-3">
                    <div
                      className={cn(
                        "w-0.5 bg-linear-to-b",
                        accentBarClasses[accent] ?? accentBarClasses.brand,
                      )}
                    />
                    <div className="flex flex-col">
                      <stat.Icon name="icon" className="text-brand mb-2 size-5" />
                      <stat.Field name="number">
                        {(props) => <div {...props} className="mb-2 text-4xl font-bold" />}
                      </stat.Field>
                      <stat.Field name="label">
                        {(props) => (
                          <p {...props} className="text-ink-muted text-sm leading-relaxed" />
                        )}
                      </stat.Field>
                    </div>
                  </div>
                );
              }}
            </statistics.Repeater>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { statistics as block };
