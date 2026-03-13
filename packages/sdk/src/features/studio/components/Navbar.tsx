import type { LinkProps } from "@tanstack/react-router";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { api } from "camox/_generated/api";
import { useQuery } from "convex/react";
import { Globe, SearchIcon, Database } from "lucide-react";
import * as icons from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useIsPreviewSheetOpen } from "@/features/preview/components/PreviewSideSheet";
import { cn } from "@/lib/utils";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { studioStore } from "../studioStore";
import { ProjectMenu } from "./ProjectMenu";
import { UserButton } from "./UserButton";

const links = [
  {
    to: "/",
    title: "Preview",
    children: (
      <>
        <Globe className="h-4 w-4" />
        Preview
      </>
    ),
    icon: "Globe",
  },
  {
    to: "/cmx-studio/content" as LinkProps["to"],
    title: "Content",
    children: (
      <>
        <Database className="h-4 w-4" />
        Content
      </>
    ),
    icon: "FileText",
  },
] satisfies Array<{
  to: LinkProps["to"];
  title: string;
  children: React.ReactNode;
  icon: keyof typeof icons;
}>;

const Navbar = () => {
  const pages = useQuery(api.pages.listPages);

  const isMac = React.useMemo(() => navigator.userAgent.toUpperCase().indexOf("MAC") >= 0, []);

  const { pathname } = useLocation();
  const isPreviewSheetOpen = useIsPreviewSheetOpen();

  return (
    <nav className="relative flex items-center justify-between gap-4 border-b-2 bg-transparent px-2 py-2">
      {/* Preview sheet overlay */}
      <div
        className={cn(
          "absolute top-0 left-0 w-full h-[calc(100%+2px)] bg-black transition-opacity z-10 will-change-auto pointer-events-none",
          isPreviewSheetOpen ? "opacity-60" : "opacity-0",
        )}
      />
      <div className="flex flex-row gap-2">
        <ProjectMenu />
        <ul className="flex items-center gap-1">
          {links.map((link, index) => (
            <li key={link.to}>
              <Link
                to={link.to}
                className={cn(
                  // common layout styles
                  "flex gap-2 items-center rounded-md px-4 py-2 text-sm font-medium",
                  // interaction styles
                  "hover:bg-accent hover:text-accent-foreground outline-none transition-[color,box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-1",
                  // active style
                  pages?.some((page) => page.fullPath === pathname) && index === 0
                    ? "bg-accent hover:bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
                activeProps={{
                  className: "bg-accent hover:bg-accent text-accent-foreground!",
                }}
              >
                {link.children}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => studioStore.send({ type: "openCommandPalette" })}>
          <SearchIcon className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">Quick find</span>
          <Kbd className="ml-4">{isMac ? "⌘" : "Ctrl"} K</Kbd>
        </Button>
        <UserButton />
      </div>
    </nav>
  );
};

function useNavbarActions() {
  const navigate = useNavigate();

  React.useEffect(() => {
    const actions = links.map((link, index) => ({
      id: `navigate-to-${link.to}`,
      label: `Go to ${link.title}`,
      groupLabel: "Navigation",
      checkIfAvailable: () => true,
      execute: () => {
        navigate({ to: link.to });
      },
      shortcut: { key: String(index + 1) },
      icon: link.icon,
    })) satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [navigate]);
}

export { Navbar, useNavbarActions };
