import { createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { colorSchemeOptions, Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

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
    scheme: setting.enum({
      default: "dark",
      options: colorSchemeOptions,
      title: "Color scheme",
    }),
  }),
  component: NavbarComponent,
  toMarkdown: (c) => [c.title, c.links, c.cta],
});

function NavbarComponent(): ReactElement {
  const sticky = navbar.useSetting("sticky");
  const scheme = navbar.useSetting("scheme");

  const innerContent = (
    <Container>
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
    </Container>
  );

  if (!sticky) {
    return (
      <Section as="nav" scheme={scheme} className="border-b py-0">
        {innerContent}
      </Section>
    );
  }

  return (
    <>
      <div aria-hidden className={cn(scheme, "bg-canvas h-navbar border-b border-transparent")} />
      <navbar.Detached>
        {(props) => (
          <Section
            {...props}
            as="nav"
            scheme={scheme}
            className="fixed top-0 right-0 left-0 z-50 border-b py-0"
          >
            {innerContent}
          </Section>
        )}
      </navbar.Detached>
    </>
  );
}

export { navbar as block };
