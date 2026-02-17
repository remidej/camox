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
    statistics: Type.RepeatableObject(
      {
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
      {
        minItems: 4,
        maxItems: 8,
        title: "Statistics",
      },
    ),
  },
  component: StatisticsComponent,
});

function StatisticsComponent() {
  return (
    <section className="dark py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          {/* Header section */}
          <div className="mb-16">
            <statistics.Field name="title">
              {(content) => (
                <div className="mb-4 text-sm font-semibold text-primary uppercase tracking-wider">
                  {content}
                </div>
              )}
            </statistics.Field>
            <statistics.Field name="subtitle">
              {(content) => (
                <h2 className="mb-6 text-4xl font-bold text-foreground sm:text-5xl lg:text-6xl">
                  {content}
                </h2>
              )}
            </statistics.Field>
            <statistics.Field name="description">
              {(content) => (
                <p className="max-w-3xl text-lg text-muted-foreground leading-relaxed">
                  {content}
                </p>
              )}
            </statistics.Field>
          </div>

          {/* Statistics grid layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <statistics.Repeater name="statistics">
              {(stat) => (
                <div className="flex gap-3">
                  <div className="w-0.5 bg-gradient-to-b from-teal-400 to-blue-500" />
                  <div className="flex flex-col">
                    <stat.Field name="number">
                      {(content) => (
                        <div className="text-4xl font-bold text-foreground mb-2">
                          {content}
                        </div>
                      )}
                    </stat.Field>
                    <stat.Field name="label">
                      {(content) => (
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {content}
                        </p>
                      )}
                    </stat.Field>
                  </div>
                </div>
              )}
            </statistics.Repeater>
          </div>
        </div>
      </div>
    </section>
  );
}

export { statistics as block };
