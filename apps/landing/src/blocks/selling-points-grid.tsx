import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { Pill } from "@/components/Pill";

const sellingPointsGrid = createBlock({
  id: "selling-points-grid",
  title: "Selling Points Grid",
  description:
    "Use this block to promote a list of aspects, benefits, or features of a product or service in a compact grid. The section opens with a pill label and a large headline, then lists selling points in a grid where each has a short title and a supporting description. Good fit for feature roundups, value propositions, or 'why choose us' sections. Works best with a multiple of 3 items so rows are complete.",
  content: (field) => ({
    pill: field.string({
      default: "Why us",
      title: "Pill label",
    }),
    title: field.string({
      default: "Why choose us.",
      title: "Title",
    }),
    items: field.repeater({
      content: (field) => ({
        icons: field.imageList({
          title: "Icons",
          defaultItems: 1,
        }),
        title: field.string({
          default: "Fast by default",
          title: "Title",
        }),
        description: field.string({
          default:
            "Built on modern primitives so every page loads instantly and stays responsive under load.",
          title: "Description",
        }),
      }),
      minItems: 3,
      maxItems: Infinity,
      title: "Selling points",
      toMarkdown: (c) => [`### ${c.title}`, c.description],
    }),
  }),
  component: SellingPointsGridComponent,
  toMarkdown: (c) => [c.pill, `## ${c.title}`, c.items],
});

function SellingPointsGridComponent() {
  return (
    <BlockContainer>
      <div className="mb-12 max-w-4xl">
        <sellingPointsGrid.Field name="pill">
          {(props) => <Pill {...props} className="mb-6" />}
        </sellingPointsGrid.Field>
        <sellingPointsGrid.Field name="title">
          {(props) => (
            <h2
              {...props}
              className="text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
            />
          )}
        </sellingPointsGrid.Field>
      </div>
      <div className="border-border w-full overflow-hidden rounded-xl border">
        <div className="bg-border grid grid-cols-1 gap-px sm:grid-cols-2 md:grid-cols-3">
          <sellingPointsGrid.Repeater name="items">
            {(item) => (
              <div className="bg-background flex h-full flex-col p-5">
                <div className="mb-2 flex flex-row items-center gap-2">
                  <item.ImageList name="icons">
                    {(props) => <img {...props} className="size-8 object-contain" />}
                  </item.ImageList>
                </div>
                <item.Field name="title">
                  {(props) => (
                    <h3 {...props} className="text-foreground mb-1.5 text-base font-semibold" />
                  )}
                </item.Field>
                <item.Field name="description">
                  {(props) => <p {...props} className="text-muted-foreground text-sm" />}
                </item.Field>
              </div>
            )}
          </sellingPointsGrid.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { sellingPointsGrid as block };
