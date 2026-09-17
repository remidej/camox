import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description:
    "Use this block as the main landing section at the top of a page. It should capture attention immediately with a clear value proposition.",
  content: {
    title: Type.String({
      default: "Let's get going on {{projectName}}",
      title: "Title",
    }),
    description: Type.String({
      default: "Press ⌘+Enter to edit this page.",
      maxLength: 280,
      title: "Description",
    }),
    cta: Type.Link({
      default: { text: "Get started", href: "/", newTab: false },
      title: "CTA",
    }),
    illustration: Type.Image({
      title: "Illustration",
    }),
  },
  settings: {
    withIllustration: Type.Boolean({
      default: true,
      title: "With illustration",
    }),
    theme: Type.Enum({
      default: "dark",
      options: { light: "Light", dark: "Dark" },
      title: "Theme",
    }),
  },
  component: HeroComponent,
  toMarkdown: (c, s) => [`# ${c.title}`, c.description, s.withIllustration(c.illustration), c.cta],
});

function HeroComponent() {
  const withIllustration = hero.useSetting("withIllustration");
  const theme = hero.useSetting("theme");

  return (
    <section
      className={cn(
        theme === "dark" ? "dark" : "light",
        "bg-background py-16 sm:py-24 md:py-28",
        !withIllustration && "flex flex-col items-center justify-center",
      )}
    >
      <div className="container mx-auto">
        <div
          className={cn(
            withIllustration
              ? "grid items-center gap-12 lg:grid-cols-[1fr_auto]"
              : "mx-auto max-w-3xl text-center",
          )}
        >
          <div className={cn(withIllustration && "text-left")}>
            <hero.Field name="title">
              {(props) => (
                <h1
                  {...props}
                  className="text-foreground mb-6 text-4xl font-bold tracking-tight sm:text-6xl"
                />
              )}
            </hero.Field>
            <hero.Field name="description">
              {(props) => <p {...props} className="text-muted-foreground mb-10 text-xl" />}
            </hero.Field>
            <hero.Link name="cta">
              {(props) => <Button size="lg" nativeButton={false} render={<Link {...props} />} />}
            </hero.Link>
          </div>
          {withIllustration && (
            <hero.Image name="illustration">
              {(props) => <img {...props} className="h-auto w-full max-w-md rounded-lg" />}
            </hero.Image>
          )}
        </div>
      </div>
    </section>
  );
}

export { hero as block };
