import { createBlock } from "camox/createBlock";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { colorSchemeSetting, Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description:
    "Use this block as the main landing section at the top of a page. It should capture attention immediately with a clear value proposition.",
  content: (field) => ({
    title: field.string({
      default: "Let's get going on {{projectName}}",
      title: "Title",
    }),
    description: field.string({
      default: "Press ⌘+Enter to edit this page.",
      maxLength: 280,
      title: "Description",
    }),
    cta: field.link({
      default: { text: "Get started", href: "/", newTab: false },
      title: "CTA",
    }),
    illustration: field.image({
      title: "Illustration",
    }),
  }),
  settings: (setting) => ({
    withIllustration: setting.boolean({
      default: true,
      title: "With illustration",
    }),
    scheme: colorSchemeSetting(setting, "dark"),
  }),
  toReact: HeroComponent,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content, settings }) => [
    `# ${content.title}`,
    content.description,
    settings.withIllustration(content.illustration),
    content.cta,
  ],
});

function HeroComponent() {
  const withIllustration = hero.useSetting("withIllustration");
  const scheme = hero.useSetting("scheme");

  return (
    <Section
      scheme={scheme}
      className={cn(!withIllustration && "flex flex-col items-center justify-center")}
    >
      <Container>
        <div
          className={cn(
            withIllustration
              ? "grid items-center gap-12 lg:grid-cols-[1fr_auto]"
              : "max-w-text mx-auto text-center",
          )}
        >
          <div className={cn(withIllustration && "text-left")}>
            <hero.Field name="title">
              {(props) => <h1 {...props} className="text-display mb-6" />}
            </hero.Field>
            <hero.Field name="description">
              {(props) => <p {...props} className="text-lead text-ink-muted mb-10" />}
            </hero.Field>
            <hero.Link name="cta">{(props) => <Button {...props} size="lg" />}</hero.Link>
          </div>
          {withIllustration && (
            <hero.Image name="illustration">
              {(props) => <img {...props} className="rounded-card h-auto w-full max-w-md" />}
            </hero.Image>
          )}
        </div>
      </Container>
    </Section>
  );
}

export { hero as block };
