import { createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

import { Container } from "@/components/ui/container";
import { colorSchemeSetting, Section } from "@/components/ui/section";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  layoutOnly: true,
  synced: true,
  description: "A footer at the bottom of a page with a site name and navigation links.",
  content: (field) => ({
    title: field.string({ default: "{{projectName}}" }),
    links: field.repeater({
      content: (field) => ({
        link: field.link({
          default: { text: "Footer link", href: "#", newTab: false },
          title: "Link",
        }),
      }),
      minItems: 2,
      maxItems: 12,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
  }),
  settings: (setting) => ({
    scheme: colorSchemeSetting(setting, "dark"),
  }),
  component: FooterComponent,
  toMarkdown: (c) => [c.title, c.links],
});

// Read when the module loads: React components must not read the clock while rendering.
const currentYear = new Date().getFullYear();

function FooterComponent() {
  const scheme = footer.useSetting("scheme");

  return (
    <Section as="footer" scheme={scheme} className="border-t py-6">
      <Container>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-2">
          <div className="flex items-center gap-2">
            <footer.Field name="title">
              {(props) => <div {...props} className="text-ink text-sm font-bold" />}
            </footer.Field>
            <div className="text-ink-muted text-sm">&copy; {currentYear}</div>
          </div>

          <div className="flex flex-col items-start gap-4 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <footer.Repeater name="links">
              {(linkItem) => (
                <linkItem.Link name="link">
                  {(props) => (
                    <Link
                      {...props}
                      className="text-ink-muted hover:text-ink text-sm transition-colors"
                    />
                  )}
                </linkItem.Link>
              )}
            </footer.Repeater>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { footer as block };
