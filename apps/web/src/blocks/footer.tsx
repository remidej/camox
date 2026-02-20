import { Type, createBlock } from "camox/createBlock";
import { Link } from "@tanstack/react-router";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  description:
    "At the bottom of a page to provide the user with links and miscellaneous information.",
  content: {
    title: Type.String({ default: "Acme" }),
    columns: Type.RepeatableObject(
      {
        title: Type.String({ default: "Column Title" }),
        links: Type.RepeatableObject(
          {
            link: Type.Link({
              default: {
                text: "Resource",
                href: "#",
                newTab: false,
              },
              title: "Link",
            }),
          },
          {
            minItems: 1,
            maxItems: 999,
          },
        ),
      },
      {
        minItems: 2,
        maxItems: 4,
        title: "Columns",
      },
    ),
  },
  component: FooterComponent,
});

function FooterComponent() {
  return (
    <footer className="dark bg-background py-16">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row gap-12 md:gap-16">
          {/* Left side: Logo + copyright */}
          <div className="md:w-1/4 shrink-0">
            <footer.Field name="title">
              {(content) => (
                <div className="text-2xl font-bold text-foreground mb-2">
                  {content}
                </div>
              )}
            </footer.Field>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} All rights reserved.
            </p>
          </div>

          {/* Right side: Link columns */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-8">
            <footer.Repeater name="columns">
              {(column) => (
                <div>
                  <column.Field name="title">
                    {(content) => (
                      <h3 className="font-semibold text-foreground mb-4">
                        {content}
                      </h3>
                    )}
                  </column.Field>
                  <ul className="space-y-2">
                    <column.Repeater name="links">
                      {(linkItem) => (
                        <li>
                          <linkItem.Link name="link">
                            {({ text, href, newTab }) => (
                              <Link
                                to={href}
                                target={newTab ? "_blank" : undefined}
                                rel={newTab ? "noreferrer" : undefined}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {text}
                              </Link>
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
