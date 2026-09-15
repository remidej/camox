import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
  layoutOnly: true,
  synced: true,
  description:
    "A navigation bar at the top of a page with a brand name, navigation links, and a call-to-action link.",
  content: {
    title: Type.Link({
      title: "Site name",
      default: {
        href: "/",
        text: "{{projectName}}",
        newTab: false,
      },
    }),
    links: Type.Repeater({
      content: {
        link: Type.Link({
          default: { text: "Link", href: "#", newTab: false },
          title: "Link",
        }),
      },
      minItems: 1,
      maxItems: 6,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
    cta: Type.Link({
      default: { text: "Get started", href: "#", newTab: false },
      title: "Call to action",
    }),
  },
  settings: {
    sticky: Type.Boolean({
      default: true,
      title: "Sticky",
    }),
  },
  component: NavbarComponent,
  toMarkdown: (c) => [c.title, c.links, c.cta],
});

function NavbarComponent(): ReactElement {
  const sticky = navbar.useSetting("sticky");

  const innerContent = (
    <div className="container mx-auto px-4">
      <div className="flex h-16 items-center justify-between">
        <navbar.Link name="title">
          {(props) => <Link {...props} className="text-foreground text-lg font-bold" />}
        </navbar.Link>

        <div className="flex items-center gap-6">
          <navbar.Repeater name="links">
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
          </navbar.Repeater>

          <navbar.Link name="cta">
            {(props) => (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link {...props} />}
              />
            )}
          </navbar.Link>
        </div>
      </div>
    </div>
  );

  if (!sticky) {
    return <nav className="dark bg-background border-border border-b">{innerContent}</nav>;
  }

  return (
    <>
      <div aria-hidden className="dark bg-background h-16 border-b border-transparent" />
      <navbar.Detached>
        {(props) => (
          <nav
            {...props}
            className="dark bg-background border-border fixed top-0 right-0 left-0 z-50 border-b"
          >
            {innerContent}
          </nav>
        )}
      </navbar.Detached>
    </>
  );
}

export { navbar as block };
