import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  layoutOnly: true,
  synced: true,
  description: "A footer at the bottom of a page with a site name and navigation links.",
  content: {
    title: Type.String({ default: "Camox" }),
    links: Type.Repeater({
      content: {
        link: Type.Link({
          default: { text: "Footer link", href: "#", newTab: false },
          title: "Link",
        }),
      },
      minItems: 2,
      maxItems: 12,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
  },
  component: FooterComponent,
  toMarkdown: (c) => [c.title, c.links],
});

function FooterComponent() {
  return (
    <footer className="dark bg-background">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-2">
          <div className="flex items-center gap-2">
            <footer.Field name="title">
              {(props) => <div {...props} className="text-foreground text-sm font-bold" />}
            </footer.Field>
            <div className="text-muted-foreground text-sm">&copy; {new Date().getFullYear()}</div>
          </div>

          <div className="flex flex-col items-start gap-4 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <footer.Repeater name="links">
              {(linkItem) => (
                <linkItem.Link name="link">
                  {(props) => (
                    <Link
                      {...props}
                      className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                    />
                  )}
                </linkItem.Link>
              )}
            </footer.Repeater>
          </div>
        </div>
      </div>
    </footer>
  );
}

export { footer as block };
