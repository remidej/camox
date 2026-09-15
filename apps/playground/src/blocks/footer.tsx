import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  layoutOnly: true,
  synced: true,
  description:
    "At the bottom of a page to provide the user with links and miscellaneous information.",
  content: {
    title: Type.String({ default: "Acme" }),
    columns: Type.Repeater({
      content: {
        title: Type.String({ default: "Column Title" }),
        links: Type.Repeater({
          content: {
            link: Type.Link({
              default: {
                text: "Resource",
                href: "#",
                newTab: false,
              },
              title: "Link",
            }),
          },
          minItems: 1,
          maxItems: 999,
          toMarkdown: (c) => [c.link],
        }),
      },
      minItems: 2,
      maxItems: 4,
      title: "Columns",
      toMarkdown: (c) => [`### ${c.title}`, c.links],
    }),
  },
  component: FooterComponent,
  toMarkdown: (c) => [c.title, c.columns],
});

function FooterComponent() {
  return (
    <footer className="dark bg-background py-16">
      <div className="container mx-auto px-4">
        <div className="flex flex-col gap-12 md:flex-row md:gap-16">
          {/* Left side: Logo + copyright */}
          <div className="shrink-0 md:w-1/4">
            <footer.Field name="title">
              {(props) => <div {...props} className="text-foreground mb-2 text-2xl font-bold" />}
            </footer.Field>
            <p className="text-muted-foreground text-sm">
              &copy; {new Date().getFullYear()} All rights reserved.
            </p>
          </div>

          {/* Right side: Link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
            <footer.Repeater name="columns">
              {(column) => (
                <div>
                  <column.Field name="title">
                    {(props) => <h3 {...props} className="text-foreground mb-4 font-semibold" />}
                  </column.Field>
                  <ul className="space-y-2">
                    <column.Repeater name="links">
                      {(linkItem) => (
                        <li>
                          <linkItem.Link name="link">
                            {(props) => (
                              <Link
                                {...props}
                                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
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
      </div>
    </footer>
  );
}

export { footer as block };
