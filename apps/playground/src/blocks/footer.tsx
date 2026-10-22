import { createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  layoutOnly: true,
  synced: true,
  description:
    "At the bottom of a page to provide the user with links and miscellaneous information.",
  content: (field) => ({
    title: field.string({ default: "Acme" }),
    columns: field.repeater({
      content: (field) => ({
        title: field.string({ default: "Column Title" }),
        links: field.repeater({
          content: (field) => ({
            link: field.link({
              default: {
                text: "Resource",
                href: "#",
                newTab: false,
              },
              title: "Link",
            }),
          }),
          minItems: 1,
          maxItems: 999,
          toMarkdown: (c) => [c.link],
        }),
      }),
      minItems: 2,
      maxItems: 4,
      title: "Columns",
      toMarkdown: (c) => [`### ${c.title}`, c.links],
    }),
  }),
  component: FooterComponent,
  toMarkdown: (c) => [c.title, c.columns],
});

// Read when the module loads: React components must not read the clock while rendering.
const currentYear = new Date().getFullYear();

function FooterComponent() {
  return (
    <Section as="footer" scheme="dark" className="py-16">
      <Container>
        <div className="flex flex-col gap-12 md:flex-row md:gap-16">
          {/* Left side: Logo + copyright */}
          <div className="shrink-0 md:w-1/4">
            <footer.Field name="title">
              {(props) => <div {...props} className="text-ink mb-2 text-2xl font-bold" />}
            </footer.Field>
            <p className="text-ink-muted text-sm">&copy; {currentYear} All rights reserved.</p>
          </div>

          {/* Right side: Link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
            <footer.Repeater name="columns">
              {(column) => (
                <div>
                  <column.Field name="title">
                    {(props) => <h3 {...props} className="text-ink mb-4 font-semibold" />}
                  </column.Field>
                  <ul className="space-y-2">
                    <column.Repeater name="links">
                      {(linkItem) => (
                        <li>
                          <linkItem.Link name="link">
                            {(props) => (
                              <Link
                                {...props}
                                className="text-ink-muted hover:text-ink text-sm transition-colors"
                              />
                            )}
                          </linkItem.Link>
                        </li>
                      )}
                    </column.Repeater>
                  </ul>
                </div>
              )}
            </footer.Repeater>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { footer as block };
