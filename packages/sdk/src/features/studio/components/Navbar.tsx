import { Button } from "@camox/ui/button";
import { Kbd } from "@camox/ui/kbd";
import { Globe, SearchIcon, Database } from "lucide-react";
import type * as icons from "lucide-react";
import * as React from "react";

import { Link, useNavigate, type LinkProps } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { cn } from "@/lib/utils";
import { useLocalePath, useLocalizedPath } from "@/lib/view-locale";

import { PlatformLabel } from "../../../components/PlatformLabel";
import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { STUDIO_CONTENT_PATH } from "../routes";
import { studioStore } from "../studioStore";
import { DraftsControl } from "./DraftsControl";
import { LocalePicker } from "./LocalePicker";
import { ProjectMenu } from "./ProjectMenu";
import { UserButton } from "./UserButton";

const links = [
  {
    to: "/",
    title: "Website",
    children: (
      <>
        <Globe className="h-4 w-4" />
        Website
      </>
    ),
    icon: "Globe",
    aliases: ["Website"],
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

export const getNavbarLinks = () => links;

export const isContentNavbarPath = (pathname: string) =>
  pathname === STUDIO_CONTENT_PATH || pathname.startsWith(`${STUDIO_CONTENT_PATH}/`);

const Navbar = ({ isWebsite = false }: { isWebsite?: boolean }) => {
  const pages = usePageDestinations();

  const pathname = useLocalePath();
  const localized = useLocalizedPath();
  return (
    <nav className="bg-background relative flex items-center justify-between gap-4 border-b-2 px-2 py-2">
      <div className="flex flex-row gap-2">
        <div className="flew-row flex gap-1">
          <ProjectMenu />
        </div>
        <ul className="flex items-center gap-1">
          {getNavbarLinks().map((link, index) => {
            const isWebsiteActive =
              index === 0 && (isWebsite || pages?.some((page) => page.fullPath === pathname));
            const isContentActive =
              link.to === STUDIO_CONTENT_PATH && isContentNavbarPath(pathname);
            return (
              <li key={link.to}>
                <Link
                  to={localized(link.to) as LinkProps["to"]}
                  className={cn(
                    // common layout styles
                    "flex gap-2 items-center rounded-md px-4 py-2 text-sm font-medium",
                    // interaction styles
                    "hover:bg-accent hover:text-accent-foreground outline-none transition-[color,box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-1",
                    // active style
                    isWebsiteActive || isContentActive
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
            );
          })}
        </ul>
      </div>
      <div className="flex items-center gap-2">
        <LocalePicker />
        <DraftsControl />
        <Button variant="outline" onClick={() => studioStore.send({ type: "openCommandPalette" })}>
          <SearchIcon className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">Quick find</span>
          <Kbd className="ml-4">
            <PlatformLabel mac="⌘ K" other="Ctrl K" />
          </Kbd>
        </Button>
        <UserButton />
      </div>
    </nav>
  );
};

function useNavbarActions() {
  const navigate = useNavigate();
  const localized = useLocalizedPath();

  React.useEffect(() => {
    const actions = getNavbarLinks().map((link, index) => ({
      id: `navigate-to-${link.to}`,
      label: `Go to ${link.title}`,
      groupLabel: "Navigation",
      checkIfAvailable: () => true,
      execute: () => {
        void navigate({ to: localized(link.to) });
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
  }, [localized, navigate]);
}

export { Navbar, useNavbarActions };
