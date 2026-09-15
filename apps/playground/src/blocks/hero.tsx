import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description:
    "Use this block as the main landing section at the top of a page. It should capture attention immediately with a clear value proposition. Typically the first block on a homepage or landing page. The title should be compelling and concise, the description should expand on the value proposition (max 280 characters), and the primary button should link to the main call-to-action.",
  content: {
    title: Type.String({
      default: "Websites you'll love to maintain",
      title: "Title",
    }),
    description: Type.String({
      default: "Meet Camox, the web toolkit designed for developers, LLMs and content editors.",
      maxLength: 280,
      title: "Description",
    }),
    illustration: Type.Image({
      title: "Illustration",
    }),
    cta: Type.Link({
      default: { text: "Start building", href: "/", newTab: false },
      title: "CTA",
    }),
  },
  settings: {
    theme: Type.Enum({
      options: {
        light: "Light",
        dark: "Dark",
      },
      default: "dark",
      title: "Theme",
    }),
    compact: Type.Boolean({
      default: false,
      title: "Compact",
    }),
  },
  component: HeroComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.description, c.illustration, c.cta],
});

function HeroComponent() {
  const theme = hero.useSetting("theme");
  const compact = hero.useSetting("compact");

  return (
    <section className={cn(theme === "dark" ? "dark" : "light")}>
      <div
        className={cn(
          "flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-white dark:from-red-950 dark:to-gray-950",
          compact ? "py-10" : "py-42",
        )}
      >
        <div className="container mx-auto px-4">
          <div
            className={cn(
              "max-w-5xl mx-auto",
              "flex flex-col lg:flex-row lg:items-center lg:gap-12",
            )}
          >
            <div className="flex-1 text-left">
              <hero.Field
                name="title"
                textStyle={({ bold }) => ({ style: bold ? { color: "red" } : undefined })}
              >
                {(props) => (
                  <h1
                    {...props}
                    className={cn(
                      "font-bold tracking-tight text-foreground leading-tight",
                      compact
                        ? "mb-4 text-2xl sm:text-3xl lg:text-4xl"
                        : "mb-8 text-4xl sm:text-6xl lg:text-7xl",
                    )}
                  />
                )}
              </hero.Field>
              <hero.Field name="description">
                {(props) => (
                  <p
                    {...props}
                    className={cn(
                      "text-red-900/70 dark:text-red-200",
                      compact ? "mb-6 text-base" : "mb-12 text-xl",
                    )}
                  />
                )}
              </hero.Field>
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <hero.Link name="cta">
                  {(props) => (
                    <Button
                      size={compact ? "default" : "lg"}
                      nativeButton={false}
                      render={<Link {...props} />}
                    />
                  )}
                </hero.Link>
              </div>
            </div>
            <hero.Image name="illustration">
              {(props) => (
                <img {...props} className="mt-10 w-full max-w-xs rounded-lg lg:mt-0 lg:max-w-sm" />
              )}
            </hero.Image>
          </div>
        </div>
      </div>
    </section>
  );
}

export { hero as block };
