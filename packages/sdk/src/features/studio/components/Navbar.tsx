import { buttonVariants } from "@camox/ui/button";
import type { HotkeyChord } from "@tanstack/react-hotkeys";
import { useSelector } from "@xstate/store-react";
import { Database, Globe } from "lucide-react";
import type * as icons from "lucide-react";
import * as React from "react";

import { Link, useNavigate, type LinkProps } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { cn } from "@/lib/utils";
import { useLocalePath, useLocalizedPath } from "@/lib/view-locale";
import { useViewLocale } from "@/lib/view-locale-context";

import type { ShownRecordPage } from "../../preview/pageRecord";
import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { STUDIO_BASE_PATH, STUDIO_CONTENT_PATH, STUDIO_SETTINGS_PATH } from "../routes";
import { studioStore, type WebsiteLocation } from "../studioStore";
import { DraftPicker, PendingChanges } from "./DraftsControl";
import { LocalePicker } from "./LocalePicker";
import { ProjectMenu } from "./ProjectMenu";
import { UserButton } from "./UserButton";

interface NavbarLink {
  to: LinkProps["to"];
  title: string;
  children: React.ReactNode;
  icon: keyof typeof icons;
  aliases: string[];
  /** The Website Section's link, which goes back where the website was last. */
  isWebsite?: boolean;
}

const links: NavbarLink[] = [
  {
    to: "/",
    title: "Website",
    isWebsite: true,
    children: (
      <>
        <Globe />
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
        <Database />
        Content
      </>
    ),
    icon: "FileText",
    aliases: ["Content", "Pages", "CMS"],
  },
];

export const getNavbarLinks = () => links;

/**
 * Where a navbar link goes. The Website goes back where it was last, Canvas included. In another
 * locale since, a Studio location stays, while a page, whose path may differ there, goes home.
 */
function navbarHref(
  link: NavbarLink,
  last: WebsiteLocation | null,
  locale: string,
  localized: (path: string) => string,
): string {
  if (!link.isWebsite || !last) return localized(link.to);
  if (last.locale === locale) return `${localized(last.path)}${last.search}${last.hash}`;
  if (last.path.startsWith(`${STUDIO_BASE_PATH}/`)) return localized(last.path);
  return localized(link.to);
}

/** Whether `pathname` is in the studio section at `sectionPath`. */
const isInSection = (sectionPath: string, pathname: string) =>
  pathname === sectionPath || pathname.startsWith(`${sectionPath}/`);

export const isContentNavbarPath = (pathname: string) => isInSection(STUDIO_CONTENT_PATH, pathname);

const isSettingsNavbarPath = (pathname: string) => isInSection(STUDIO_SETTINGS_PATH, pathname);

const Navbar = ({
  isWebsite = false,
  recordPage,
}: {
  isWebsite?: boolean;
  /** The record page the website shows, which switching locales keeps. */
  recordPage?: ShownRecordPage;
}) => {
  const pages = usePageDestinations();

  const pathname = useLocalePath();
  const localized = useLocalizedPath();
  const { locale } = useViewLocale();
  const last = useSelector(studioStore, (state) => state.context.websiteLocation);
  // Project Settings apply to Live and every draft in every locale: nothing to pick there.
  const isSettings = isSettingsNavbarPath(pathname);
  return (
    <nav className="bg-background relative flex items-center justify-between gap-4 border-b px-2 py-2">
      <div className="flex flex-row gap-2">
        <div className="flex items-center gap-1">
          <ProjectMenu />
          <DraftPicker disabled={isSettings} />
          <LocalePicker recordPage={recordPage} disabled={isSettings} />
        </div>
        <ul className="flex items-center gap-1">
          {getNavbarLinks().map((link) => {
            const isActive = link.isWebsite
              ? isWebsite || !!pages?.some((page) => page.fullPath === pathname)
              : isInSection(link.to, pathname);
            return (
              <li key={link.to}>
                <Link
                  to={navbarHref(link, last, locale.tag, localized) as LinkProps["to"]}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    // Shaped like the pickers beside it.
                    buttonVariants({ variant: "ghost" }),
                    isActive
                      ? "bg-muted text-foreground dark:bg-muted/50"
                      : // Hover only shades the background, so it never reads as active.
                        "text-muted-foreground hover:text-muted-foreground",
                  )}
                  activeProps={{ className: "bg-muted text-foreground! dark:bg-muted/50" }}
                >
                  {link.children}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center gap-2">
        <PendingChanges />
        <UserButton />
      </div>
    </nav>
  );
};

function useNavbarActions() {
  const navigate = useNavigate();
  const localized = useLocalizedPath();
  const { locale } = useViewLocale();

  React.useEffect(() => {
    const actions = getNavbarLinks().map((link, index) => ({
      id: `navigate-to-${link.to}`,
      label: `Go to ${link.title}`,
      groupLabel: "Navigation",
      checkIfAvailable: () => true,
      execute: () => {
        const last = studioStore.getSnapshot().context.websiteLocation;
        void navigate({ to: navbarHref(link, last, locale.tag, localized) });
      },
      shortcut: `${index + 1}` as HotkeyChord,
      icon: link.icon,
      aliases: link.aliases,
    })) satisfies Action[];
    // Settings has no navbar link, only its project menu item, but it can still be reached here.
    actions.push({
      id: `navigate-to-${STUDIO_SETTINGS_PATH}`,
      label: "Go to Settings",
      groupLabel: "Navigation",
      checkIfAvailable: () => true,
      execute: () => void navigate({ to: localized(STUDIO_SETTINGS_PATH) }),
      shortcut: `${actions.length + 1}` as HotkeyChord,
      icon: "Settings",
      aliases: [
        "Settings",
        "Project settings",
        "Project name",
        "Favicon",
        "Social profiles",
        "Analytics",
      ],
    });

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [locale.tag, localized, navigate]);
}

export { Navbar, useNavbarActions };
