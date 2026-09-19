import { Type, createBlock } from "camox/createBlock";
import { getElementContext } from "camox/dom";
import { Link } from "camox/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
  layoutOnly: true,
  synced: true,
  description:
    "A navigation bar at the top of a page with a brand name, navigation links, a call-to-action link.",
  content: {
    title: Type.Link({
      title: "Site name",
      default: {
        href: "/",
        text: "Acme",
        newTab: false,
      },
    }),
    links: Type.Repeater({
      content: {
        link: Type.Link({
          default: {
            text: "Link",
            href: "#",
            newTab: false,
          },
          title: "Link",
        }),
      },
      minItems: 1,
      maxItems: 6,
      title: "Links",
      toMarkdown: (c) => [c.link],
    }),
    cta: Type.Link({
      default: { text: "Get Started", href: "#", newTab: false },
      title: "CTA",
    }),
  },
  settings: {
    floating: Type.Boolean({
      default: true,
      title: "Floating on scroll",
    }),
  },
  component: NavbarComponent,
  toMarkdown: (c) => [c.title, c.links, c.cta],
});

function NavbarContent() {
  return (
    <div className="container mx-auto px-4">
      <div className="flex h-16 items-center justify-between">
        <navbar.Link name="title">
          {(props) => <Link {...props} className="text-foreground text-xl font-bold" />}
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
            {(props) => <Button size="sm" nativeButton={false} render={<Link {...props} />} />}
          </navbar.Link>
        </div>
      </div>
    </div>
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
    <div className="dark relative">
      {/* Sentinel element — when this scrolls out, the navbar floats */}
      <div ref={sentinelRef} className="absolute top-[calc(100%+50px)] h-0 w-full p-2" />
      {/* Static navbar */}
      <nav className="bg-background border-border border-b">
        <NavbarContent />
      </nav>

      {/* Floating navbar */}
      {floating && (
        <navbar.Detached>
          {(props) => (
            <nav
              {...props}
              className={cn(
                "fixed top-4 left-4 right-4 z-50 rounded-xl border border-border bg-background/80 backdrop-blur-lg shadow-lg transition-all",
                isFloating
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-[calc(100%+2rem)] opacity-0 pointer-events-none",
              )}
            >
              <NavbarContent />
            </nav>
          )}
        </navbar.Detached>
      )}
    </div>
  );
}

export { navbar as block };
