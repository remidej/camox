import { createBlock } from "camox/createBlock";
import { Check } from "lucide-react";

import { BlockContainer } from "@/components/BlockContainer";
import { InlineHeading } from "@/components/InlineHeading";
import { Pill } from "@/components/Pill";

const featureVideoGrid = createBlock({
  id: "feature-video-grid",
  title: "Feature Video Grid",
  description:
    "Use this block to showcase two product features with short autoplaying videos, compact copy, and small supporting points. It is a generic marketing section for visual product capabilities, feature launches, workflow demos, or before/after interactions. Keep the text concise and let the looping videos carry the explanation.",
  content: (field) => ({
    pill: field.string({
      default: "Features",
      title: "Pill label",
    }),
    title: field.string({
      default: "Features you can see.",
      title: "Title",
    }),
    description: field.string({
      default:
        "Short looping videos show the product in motion, with just enough copy to explain why each capability matters.",
      title: "Description",
    }),
    items: field.repeater({
      content: (field) => ({
        label: field.string({
          default: "Feature",
          title: "Label",
        }),
        title: field.string({
          default: "A visual product capability",
          title: "Title",
        }),
        description: field.string({
          default: "Show the workflow in a short loop, then explain the outcome in one sentence.",
          title: "Description",
        }),
        video: field.file({
          accept: ["video/mp4", "video/webm", "video/quicktime"],
          title: "Feature video",
        }),
        points: field.repeater({
          content: (field) => ({
            text: field.string({
              default: "A concise supporting point",
              title: "Point",
            }),
          }),
          minItems: 1,
          maxItems: 4,
          title: "Points",
          toMarkdown: (c) => [c.text],
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Feature videos",
      toMarkdown: (c) => [`### ${c.title}`, c.label, c.description, c.video, c.points],
    }),
  }),
  component: FeatureVideoGridComponent,
  toMarkdown: (c) => [c.pill, `## ${c.title}`, c.description, c.items],
});

function FeatureVideoGridComponent() {
  return (
    <BlockContainer>
      <div className="mb-14 max-w-4xl">
        <featureVideoGrid.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </featureVideoGrid.Field>
        <InlineHeading
          lead={
            <featureVideoGrid.Field name="title">
              {(props) => <span {...props} />}
            </featureVideoGrid.Field>
          }
          continuation={
            <featureVideoGrid.Field name="description">
              {(props) => <span {...props} />}
            </featureVideoGrid.Field>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:gap-8">
        <featureVideoGrid.Repeater name="items">
          {(item) => (
            <article className="border-border bg-background overflow-hidden rounded-2xl border">
              <div className="border-border bg-muted border-b">
                <div className="aspect-video overflow-hidden">
                  <item.File name="video">
                    {(_props, { url }) => (
                      <video
                        src={url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        controls={false}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </item.File>
                </div>
              </div>

              <div className="flex flex-col gap-3 px-5 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-7">
                <div>
                  <item.Field name="label">
                    {(props) => (
                      <p
                        {...props}
                        className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.16em] uppercase"
                      />
                    )}
                  </item.Field>
                  <item.Field name="title">
                    {(props) => (
                      <h3
                        {...props}
                        className="text-foreground text-2xl leading-tight font-semibold tracking-tight"
                      />
                    )}
                  </item.Field>
                </div>
                <item.Field name="description">
                  {(props) => (
                    <p
                      {...props}
                      className="text-muted-foreground max-w-prose text-sm leading-snug"
                    />
                  )}
                </item.Field>
                <div className="flex flex-wrap gap-2">
                  <item.Repeater name="points">
                    {(point) => (
                      <div className="border-border bg-popover flex items-center gap-2 rounded-full border px-3 py-1.5">
                        <Check aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
                        <point.Field name="text">
                          {(props) => (
                            <span {...props} className="text-foreground text-xs font-medium" />
                          )}
                        </point.Field>
                      </div>
                    )}
                  </item.Repeater>
                </div>
              </div>
            </article>
          )}
        </featureVideoGrid.Repeater>
      </div>
    </BlockContainer>
  );
}

export { featureVideoGrid as block };
