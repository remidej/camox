import { Button } from "@camox/ui/button";
import { Type, createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
  layoutOnly: true,
  synced: true,
  description:
    "A navigation bar at the top of the page with a logo image on the left, navigation links in the middle, and a dashboard button on the right.",
  content: {
    logo: Type.Image({
      title: "Logo",
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
  },
  component: NavbarComponent,
  toMarkdown: (c) => [c.logo, c.links],
});

function NavbarContent() {
  const dashboardUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_DASHBOARD_URL ?? "http://localhost:3274")
    : "https://app.camox.dev";

  return (
    <div className="container">
      <div className="flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center">
          <navbar.Image name="logo">
            {(props) => <img {...props} className="h-8 w-auto" />}
          </navbar.Image>
        </Link>

        <div className="flex items-center gap-6">
          <div className="hidden items-center gap-4 md:flex">
            <navbar.Repeater name="links">
              {(linkItem) => (
                <linkItem.Link name="link">
                  {(props) => <Link {...props} className="px-2 py-1 text-sm transition-colors" />}
                </linkItem.Link>
              )}
            </navbar.Repeater>
          </div>

          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a href={dashboardUrl}>
                Dashboard <ArrowRight className="text-muted-foreground" />
              </a>
            }
          />
        </div>
      </div>
    </div>
  );
}

function NavbarComponent() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsScrolled(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="absolute top-0 h-px w-full" />
      <navbar.Detached>
        {(props) => (
          <nav
            {...props}
            className={cn(
              "fixed inset-x-0 top-0 z-50 transition-colors",
              isScrolled && "border-border border-b bg-black",
            )}
          >
            <NavbarContent />
          </nav>
        )}
      </navbar.Detached>
    </>
  );
}

export { navbar as block };
