import { Type, createBlock } from "camox/createBlock";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
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
    links: Type.RepeatableObject(
      {
        link: Type.Link({
          default: {
            text: "Link",
            href: "#",
            newTab: false,
          },
          title: "Link",
        }),
      },
      {
        minItems: 1,
        maxItems: 6,
        title: "Links",
      },
    ),
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
});

function NavbarContent() {
  return (
    <div className="container mx-auto px-4">
      <div className="flex items-center justify-between h-16">
        <navbar.Link name="title">
          {(link) => (
            <Link className="text-xl font-bold text-foreground" to={link.href}>
              {link.text}
            </Link>
          )}
        </navbar.Link>

        <div className="flex items-center gap-6">
          <navbar.Repeater name="links">
            {(linkItem) => (
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
            )}
          </navbar.Repeater>

          <navbar.Link name="cta">
            {({ text, href, newTab }) => (
              <Button size="sm" asChild>
                <Link
                  to={href}
                  target={newTab ? "_blank" : undefined}
                  rel={newTab ? "noreferrer" : undefined}
                >
                  {text}
                </Link>
              </Button>
            )}
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

    const observer = new IntersectionObserver(
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
      <div
        ref={sentinelRef}
        className="h-0 p-2 w-full absolute top-[calc(100%+50px)]"
      />
      {/* Static navbar */}
      <nav className="bg-background border-b border-border">
        <NavbarContent />
      </nav>

      {/* Floating navbar */}
      {floating && (
        <nav
          className={cn(
            "fixed top-4 left-4 right-4 z-50 rounded-xl border border-border bg-background/80 backdrop-blur-lg shadow-lg transition-all duration-300",
            isFloating
              ? "translate-y-0 opacity-100"
              : "-translate-y-full opacity-0 pointer-events-none",
          )}
        >
          <NavbarContent />
        </nav>
      )}
    </div>
  );
}

export { navbar as block };
