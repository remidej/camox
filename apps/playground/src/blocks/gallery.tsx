import { createBlock } from "camox/createBlock";

import { cn } from "@/lib/utils";

const gallery = createBlock({
  id: "gallery",
  title: "Gallery",
  description:
    "A grid of images. Use this block to showcase a collection of visuals such as product screenshots, team photos, or portfolio pieces. Works well as a standalone section or between text-heavy blocks to break up the page.",
  content: (field) => ({
    title: field.string({
      default: "Gallery",
      title: "Title",
    }),
    images: field.imageList({
      defaultItems: 6,
      title: "Images",
    }),
  }),
  settings: (setting) => ({
    columns: setting.enum({
      options: {
        "2": "2 columns",
        "3": "3 columns",
        "4": "4 columns",
      },
      default: "3",
      title: "Columns",
    }),
  }),
  component: GalleryComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.images],
});

function GalleryComponent() {
  const columns = gallery.useSetting("columns");

  return (
    <section className="py-16">
      <div className="container mx-auto px-4">
        <gallery.Field name="title">
          {(props) => (
            <h2 {...props} className="text-foreground mb-8 text-3xl font-bold tracking-tight" />
          )}
        </gallery.Field>
        <div
          className={cn(
            "grid gap-4",
            columns === "2" && "grid-cols-1 sm:grid-cols-2",
            columns === "3" && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            columns === "4" && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
          )}
        >
          <gallery.ImageList name="images">
            {(props) => <img {...props} className="aspect-square w-full rounded-lg object-cover" />}
          </gallery.ImageList>
        </div>
      </div>
    </section>
  );
}

export { gallery as block };
