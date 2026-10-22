import { createBlock } from "camox/createBlock";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { colorSchemeOptions, Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description:
    "Use this block as the main landing section at the top of a page. It should capture attention immediately with a clear value proposition. Typically the first block on a homepage or landing page. The title should be compelling and concise, the description should expand on the value proposition (max 280 characters), and the primary button should link to the main call-to-action.",
  content: (field) => ({
    title: field.string({
      default: "Websites you'll love to maintain",
      title: "Title",
    }),
    description: field.string({
      default: "Meet Camox, the web toolkit designed for developers, LLMs and content editors.",
      maxLength: 280,
      title: "Description",
    }),
    globe: field.artifact({
      size: "fill",
      data: ["rotationSpeed", "initialPosition"],
      title: "Globe",
    }),
    cta: field.link({
      default: { text: "Start building", href: "/", newTab: false },
      title: "CTA",
    }),
  }),
  settings: (setting) => ({
    scheme: setting.enum({
      default: "dark",
      options: colorSchemeOptions,
      title: "Color scheme",
    }),
    compact: setting.boolean({
      default: false,
      title: "Compact",
    }),
    rotationSpeed: setting.enum({
      options: {
        slow: "Slow",
        fast: "Fast",
      },
      default: "slow",
      title: "Globe rotation speed",
    }),
    initialPosition: setting.enum({
      options: {
        americas: "Americas",
        emea: "EMEA",
        asia: "Asia",
        pacific: "Pacific",
      },
      default: "emea",
      title: "Globe initial position",
    }),
  }),
  component: HeroComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.description, c.globe, c.cta],
});

function HeroComponent() {
  const scheme = hero.useSetting("scheme");
  const compact = hero.useSetting("compact");

  return (
    <Section
      scheme={scheme}
      className={cn("bg-linear-to-br from-brand/15 to-transparent", compact && "py-10")}
    >
      <Container>
        <div className="mx-auto flex max-w-5xl flex-col lg:flex-row lg:items-center lg:gap-12">
          <div className="flex-1 text-left">
            <hero.Field
              name="title"
              textStyle={({ bold }) => ({
                style: bold ? { color: "var(--brand)" } : undefined,
              })}
            >
              {(props) => (
                <h1
                  {...props}
                  className={cn(compact ? "text-heading mb-4" : "text-display mb-8")}
                />
              )}
            </hero.Field>
            <hero.Field name="description">
              {(props) => (
                <p
                  {...props}
                  className={cn("text-ink-muted", compact ? "mb-6 text-base" : "text-lead mb-12")}
                />
              )}
            </hero.Field>
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <hero.Link name="cta">
                {(props) => <Button {...props} size={compact ? "md" : "lg"} />}
              </hero.Link>
            </div>
          </div>
          <div className="mt-10 aspect-square w-full max-w-xs lg:mt-0 lg:max-w-sm">
            <hero.Artifact name="globe">
              {(props) => <iframe {...props} className="size-full" />}
            </hero.Artifact>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { hero as block };
