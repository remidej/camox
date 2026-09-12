import { Button } from "@camox/ui/button";
import { Kbd } from "@camox/ui/kbd";
import { useQuery } from "@tanstack/react-query";
import { Globe, SearchIcon, Database } from "lucide-react";
import type * as icons from "lucide-react";
import * as React from "react";

import { Link, useLocation, useNavigate, type LinkProps } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import { pageQueries, projectQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { STUDIO_CONTENT_PATH } from "../routes";
import { studioStore } from "../studioStore";
import { EnvironmentMenu } from "./EnvironmentMenu";
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
    aliases: ["Preview", "Website"],
  },
  {
    to: STUDIO_CONTENT_PATH as LinkProps["to"],
    title: "Content",
    children: (
      <>
        <Database className="h-4 w-4" />
        Content
      </>
    ),
    icon: "FileText",
    aliases: ["Content", "Pages", "CMS"],
  },
] satisfies Array<{
  to: LinkProps["to"];
  title: string;
  children: React.ReactNode;
  icon: keyof typeof icons;
  aliases: string[];
}>;

const Navbar = ({ isPreview = false }: { isPreview?: boolean }) => {
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });

  const isMac = React.useMemo(
    () => typeof navigator !== "undefined" && navigator.userAgent.toUpperCase().indexOf("MAC") >= 0,
    [],
  );

  const { pathname } = useLocation();
  return (
    <nav className="bg-background relative flex items-center justify-between gap-4 border-b-2 px-2 py-2">
      <div className="flex flex-row gap-2">
        <div className="flew-row flex gap-1">
          <ProjectMenu />
          <EnvironmentMenu />
        </div>
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
                  (isPreview || pages?.some((page) => page.fullPath === pathname)) && index === 0
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
        void navigate({ to: link.to });
      },
      shortcut: { key: String(index + 1) },
      icon: link.icon,
      aliases: link.aliases,
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
