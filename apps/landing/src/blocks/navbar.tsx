import { createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { MobileMenu } from "@/components/ui/mobile-menu";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const navbar = createBlock({
  id: "navbar",
  title: "Navbar",
  layoutOnly: true,
  synced: true,
  description:
    "A navigation bar at the top of the page with a logo image on the left, navigation links in the middle, and a dashboard button on the right.",
  content: (field) => ({
    logo: field.image({
      title: "Logo",
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
  }),
  component: NavbarComponent,
  toMarkdown: (c) => [c.logo, c.links],
});

function NavbarContent() {
  const dashboardUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_DASHBOARD_URL ?? "http://localhost:3274")
    : "https://app.camox.dev";

  return (
    <Container>
      <div className="h-navbar flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <navbar.Image name="logo">
            {(props) => <img {...props} className="h-7 w-auto" />}
          </navbar.Image>
        </Link>

        <div className="flex items-center gap-2 md:gap-6">
          <MobileMenu wrapperClassName="order-last md:order-none" className="md:gap-4">
            <navbar.Repeater name="links">
              {(linkItem) => (
                <linkItem.Link name="link">
                  {(props) => <Link {...props} className="px-2 py-1 text-sm transition-colors" />}
                </linkItem.Link>
              )}
            </navbar.Repeater>
          </MobileMenu>

          <Button href={dashboardUrl} size="sm" variant="outline">
            Dashboard <ArrowRight className="text-ink-muted" />
          </Button>
        </div>
      </div>
    </Container>
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
          <Section
            {...props}
            as="nav"
            scheme="dark"
            className={cn(
              "fixed inset-x-0 top-0 z-50 bg-transparent py-0 transition-colors",
              isScrolled && "border-b bg-black",
            )}
          >
            <NavbarContent />
          </Section>
        )}
      </navbar.Detached>
    </>
  );
}

export { navbar as block };
