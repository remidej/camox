import { createBlock } from "camox/createBlock";

import { Carousel, CarouselSlide } from "@/components/ui/carousel";
import { Container } from "@/components/ui/container";
import { colorSchemeSetting, Section } from "@/components/ui/section";

const gallery = createBlock({
  id: "gallery",
  title: "Gallery",
  description:
    "Use this block to show a series of images with captions in a carousel that visitors swipe or scroll through, such as product shots, screenshots or event photos.",
  content: (field) => ({
    title: field.string({
      default: "See it in action",
      title: "Title",
    }),
    slides: field.repeater({
      content: (field) => ({
        image: field.image({
          title: "Image",
        }),
        caption: field.string({
          default: "A short caption for this image",
          maxLength: 140,
          title: "Caption",
        }),
      }),
      minItems: 3,
      maxItems: 12,
      title: "Slides",
      toTitle: ({ content }) => content.caption,
      toMarkdown: ({ content }) => [content.image, content.caption],
    }),
  }),
  settings: (setting) => ({
    scheme: colorSchemeSetting(setting, "light"),
  }),
  toReact: GalleryComponent,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [`# ${content.title}`, content.slides],
});

function GalleryComponent() {
  const scheme = gallery.useSetting("scheme");

  return (
    <Section scheme={scheme}>
      <Container>
        <gallery.Field name="title">
          {(props) => <h2 {...props} className="text-heading mb-10" />}
        </gallery.Field>
        <Carousel label="Gallery">
          <gallery.Repeater name="slides">
            {(item) => (
              <CarouselSlide className="md:basis-[calc(50%-0.5rem)]">
                <figure className="flex flex-col gap-3">
                  <item.Image name="image">
                    {(props) => (
                      <img {...props} className="rounded-card aspect-[4/3] w-full object-cover" />
                    )}
                  </item.Image>
                  <item.Field name="caption">
                    {(props) => <figcaption {...props} className="text-ink-muted text-sm" />}
                  </item.Field>
                </figure>
              </CarouselSlide>
            )}
          </gallery.Repeater>
        </Carousel>
      </Container>
    </Section>
  );
}

export { gallery as block };
