import { useClerk } from "@clerk/clerk-react";
import { api } from "camox/_generated/api";
import { useQuery } from "convex/react";
import { ChevronDown, Globe, Settings, Users } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { ProjectSettingsModal } from "./ProjectSettingsModal";

const Favicon = ({ size = 16 }: { size?: number }) => {
  const [faviconUrl, setFaviconUrl] = React.useState<string | null>(null);
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    const getFaviconUrl = () => {
      const selectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
      ];

      for (const selector of selectors) {
        const link = document.querySelector(selector) as HTMLLinkElement;
        if (link?.href) {
          return link.href;
        }
      }
      return null;
    };

    const url = getFaviconUrl();
    setFaviconUrl(url);
  }, []);

  if (!faviconUrl || hasError) {
    return (
      <div
        className="bg-muted flex items-center justify-center rounded-full"
        style={{ height: size, width: size }}
      >
        <Globe
          className="text-muted-foreground"
          style={{ height: size * 0.6, width: size * 0.6 }}
        />
      </div>
    );
  }

  return (
    <div
      className="bg-muted flex items-center justify-center overflow-hidden rounded-full"
      style={{ height: size, width: size }}
    >
      <img
        src={faviconUrl}
        alt="Favicon"
        className="h-full w-full object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
};

export const ProjectMenu = () => {
  const [open, setOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const { openOrganizationProfile } = useClerk();
  const project = useQuery(api.projects.getFirstProject);

  if (!project) {
    return (
      <div className="flex h-9 min-w-[150px] items-center gap-2 px-4">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-3 flex-1" />
      </div>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="min-w-[150px] justify-between gap-2">
            <div className="flex items-center gap-2">
              <Favicon size={16} />
              <span>{project.name}</span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start" side="bottom">
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 p-4">
              <h3 className="font-mono text-sm leading-none">{project.domain}</h3>
              <p className="text-muted-foreground text-sm">{project.description}</p>
            </div>
            <Separator />
            <div className="flex flex-col gap-1 p-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  openOrganizationProfile();
                  setOpen(false);
                }}
              >
                <Users className="text-muted-foreground size-4" />
                Manage team
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setSettingsOpen(true);
                  setOpen(false);
                }}
              >
                <Settings className="text-muted-foreground size-4" />
                Project settings
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <ProjectSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
};
