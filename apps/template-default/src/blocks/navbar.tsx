import { createBlock } from "camox/createBlock";
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
  content: (field) => ({
    title: field.link({
      title: "Site name",
      default: {
        href: "/",
        text: "{{projectName}}",
        newTab: false,
      },
    }),
    links: field.repeater({
      content: (field) => ({
        link: field.link({
          default: { text: "Link", href: "#", newTab: false },
          title: "Link",
        }),
      }),
      minItems: 1,
      maxItems: 6,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
    cta: field.link({
      default: { text: "Get started", href: "#", newTab: false },
      title: "Call to action",
    }),
  }),
  settings: (setting) => ({
    sticky: setting.boolean({
      default: true,
      title: "Sticky",
    }),
  }),
  component: NavbarComponent,
  toMarkdown: (c) => [c.title, c.links, c.cta],
});

function NavbarComponent(): ReactElement {
  const sticky = navbar.useSetting("sticky");

  const innerContent = (
    <div className="max-w-page px-gutter mx-auto">
      <div className="h-navbar flex items-center justify-between">
        <navbar.Link name="title">
          {(props) => <Link {...props} className="text-ink font-heading text-lg font-bold" />}
        </navbar.Link>

        <div className="flex items-center gap-6">
          <navbar.Repeater name="links">
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
    return <nav className="dark bg-canvas border-b">{innerContent}</nav>;
  }

  return (
    <>
      <div aria-hidden className="dark bg-canvas h-navbar border-b border-transparent" />
      <navbar.Detached>
        {(props) => (
          <nav {...props} className="dark bg-canvas fixed top-0 right-0 left-0 z-50 border-b">
            {innerContent}
          </nav>
        )}
      </navbar.Detached>
    </>
  );
}

export { navbar as block };
