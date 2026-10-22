import { createBlock } from "camox/createBlock";
import { getElementContext } from "camox/dom";
import { Link } from "camox/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
  layoutOnly: true,
  synced: true,
  description:
    "A navigation bar at the top of a page with a brand name, navigation links, a call-to-action link.",
  content: (field) => ({
    title: field.link({
      title: "Site name",
      default: {
        href: "/",
        text: "Acme",
        newTab: false,
      },
    }),
    links: field.repeater({
      content: (field) => ({
        link: field.link({
          default: {
            text: "Link",
            href: "#",
            newTab: false,
          },
          title: "Link",
        }),
      }),
      minItems: 1,
      maxItems: 6,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
    cta: field.link({
      default: { text: "Get Started", href: "#", newTab: false },
      title: "CTA",
    }),
  }),
  settings: (setting) => ({
    floating: setting.boolean({
      default: true,
      title: "Floating on scroll",
    }),
  }),
  component: NavbarComponent,
  toMarkdown: (c) => [c.title, c.links, c.cta],
});

function NavbarContent() {
  return (
    <Container>
      <div className="h-navbar flex items-center justify-between">
        <navbar.Link name="title">
          {(props) => <Link {...props} className="text-xl font-bold" />}
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

          <navbar.Link name="cta">{(props) => <Button {...props} size="sm" />}</navbar.Link>
        </div>
      </div>
    </Container>
  );
}

function NavbarComponent() {
  const floating = navbar.useSetting("floating");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isFloating, setIsFloating] = useState(false);

  useEffect(() => {
    if (!floating) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const context = getElementContext(sentinel);
    if (!context) return;

    const observer = new context.window.IntersectionObserver(
      ([entry]) => {
        setIsFloating(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [floating]);

  return (
    <div className="relative">
      {/* Sentinel element — when this scrolls out, the navbar floats */}
      <div ref={sentinelRef} className="absolute top-[calc(100%+50px)] h-0 w-full p-2" />
      {/* Static navbar */}
      <Section as="nav" scheme="dark" className="border-b py-0">
        <NavbarContent />
      </Section>

      {/* Floating navbar */}
      {floating && (
        <navbar.Detached>
          {(props) => (
            <Section
              {...props}
              as="nav"
              scheme="dark"
              className={cn(
                "fixed top-4 left-4 right-4 z-50 rounded-card border bg-canvas/80 py-0 backdrop-blur-lg shadow-lg transition-all",
                isFloating
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-[calc(100%+2rem)] opacity-0 pointer-events-none",
              )}
            >
              <NavbarContent />
            </Section>
          )}
        </navbar.Detached>
      )}
    </div>
  );
}

export { navbar as block };
