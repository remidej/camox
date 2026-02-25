import { Type, createBlock } from "camox/createBlock";
import { cn } from "@/lib/utils";

const gallery = createBlock({
  id: "gallery",
  title: "Gallery",
  description:
    "A grid of images. Use this block to showcase a collection of visuals such as product screenshots, team photos, or portfolio pieces. Works well as a standalone section or between text-heavy blocks to break up the page.",
  content: {
    title: Type.String({
      default: "Gallery",
      title: "Title",
    }),
    images: Type.Image({
      multiple: true,
      defaultItems: 6,
      title: "Images",
    }),
  },
  settings: {
    columns: Type.Enum({
      options: {
        "2": "2 columns",
        "3": "3 columns",
        "4": "4 columns",
      },
      default: "3",
      title: "Columns",
    }),
  },
  component: GalleryComponent,
});

function GalleryComponent() {
  const columns = gallery.useSetting("columns");

  return (
    <section className="py-16">
      <div className="container mx-auto px-4">
        <gallery.Field name="title">
          {(content) => (
            <h2 className="text-3xl font-bold tracking-tight text-foreground mb-8">
              {content}
            </h2>
          )}
        </gallery.Field>
        <div
          className={cn(
            "grid gap-4",
            columns === "2" && "grid-cols-1 sm:grid-cols-2",
            columns === "3" && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            columns === "4" &&
              "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
          )}
        >
          <gallery.Repeater name="images">
            {(item) => (
              <item.Image name="image">
                {(img) => (
                  <img
                    src={img.url}
                    alt={img.alt}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                )}
              </item.Image>
            )}
          </gallery.Repeater>
        </div>
      </div>
    </section>
  );
}

export { gallery as block };
