import { Type, createBlock } from "camox/createBlock";

const statistics = createBlock({
  id: "statistics",
  title: "Statistics",
  description:
    'Use this block to showcase key metrics, achievements, or performance indicators. Ideal for displaying platform statistics, product metrics, company milestones, or any quantifiable data. Place this block in sections where you want to build credibility or highlight important numbers. Each statistic should have a number (can include units like "M+", "%", "ms") and a descriptive label.',
  content: {
    title: Type.String({
      default: "Platform performance",
      maxLength: 30,
      title: "Title",
    }),
    subtitle: Type.String({
      default: "Built for modern web development",
      title: "Subtitle",
    }),
    description: Type.String({
      default:
        "Camox empowers developers to build and deploy websites with unprecedented speed and flexibility. Our platform handles millions of page views and serves content globally with enterprise-grade reliability.",
      title: "Description",
    }),
    statistics: Type.Repeater({
      content: {
        icon: Type.Icon({
          title: "Icon",
          default: "lucide:zap",
        }),
        number: Type.String({
          default: "100M+",
          maxLength: 7,
          title: "Number",
        }),
        label: Type.String({
          default: "pages served monthly across all projects.",
          title: "Label",
        }),
      },
      settings: {
        color: Type.Enum({
          default: "teal",
          options: {
            teal: "Teal",
            purple: "Purple",
            amber: "Amber",
            rose: "Rose",
          },
          title: "Color",
        }),
      },
      minItems: 4,
      maxItems: 8,
      title: "Statistics",
      toMarkdown: (c, s) => [s.color("teal", `**${c.number}** — ${c.label}`)],
    }),
  },
  component: StatisticsComponent,
  toMarkdown: (c) => [`## ${c.subtitle}`, c.description, c.statistics],
});

function StatisticsComponent() {
  return (
    <section className="dark bg-background py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl">
          {/* Header section */}
          <div className="mb-16">
            <statistics.Field name="title">
              {(props) => (
                <div
                  {...props}
                  className="text-primary mb-4 text-sm font-semibold tracking-wider uppercase"
                />
              )}
            </statistics.Field>
            <statistics.Field name="subtitle">
              {(props) => (
                <h2
                  {...props}
                  className="text-foreground mb-6 text-4xl font-bold sm:text-5xl lg:text-6xl"
                />
              )}
            </statistics.Field>
            <statistics.Field name="description">
              {(props) => (
                <p {...props} className="text-muted-foreground max-w-3xl text-lg leading-relaxed" />
              )}
            </statistics.Field>
          </div>

          {/* Statistics grid layout */}
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            <statistics.Repeater name="statistics">
              {(stat) => {
                const color = stat.useSetting("color");
                const borderClass = {
                  teal: "bg-linear-to-b from-teal-400 to-blue-500",
                  purple: "bg-linear-to-b from-purple-400 to-fuchsia-500",
                  amber: "bg-linear-to-b from-amber-400 to-orange-500",
                  rose: "bg-linear-to-b from-rose-400 to-pink-500",
                }[color];
                return (
                  <div className="flex gap-3">
                    <div className={`w-0.5 ${borderClass}`} />
                    <div className="flex flex-col">
                      <stat.Icon name="icon" className="text-primary mb-2 size-5" />
                      <stat.Field name="number">
                        {(props) => (
                          <div {...props} className="text-foreground mb-2 text-4xl font-bold" />
                        )}
                      </stat.Field>
                      <stat.Field name="label">
                        {(props) => (
                          <p {...props} className="text-muted-foreground text-sm leading-relaxed" />
                        )}
                      </stat.Field>
                    </div>
                  </div>
                );
              }}
            </statistics.Repeater>
          </div>
        </div>
      </div>
    </section>
  );
}

export { statistics as block };
