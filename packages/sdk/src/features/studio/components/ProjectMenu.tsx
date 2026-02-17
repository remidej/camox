import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Globe, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "convex/react";
import { api } from "camox/_generated/api";
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
        className="flex items-center justify-center rounded-full bg-muted"
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
      className="flex items-center justify-center rounded-full bg-muted overflow-hidden"
      style={{ height: size, width: size }}
    >
      <img
        src={faviconUrl}
        alt="Favicon"
        className="object-cover w-full h-full"
        onError={() => setHasError(true)}
      />
    </div>
  );
};

export const ProjectMenu = () => {
  const [open, setOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const project = useQuery(api.projects.getFirstProject);

  if (!project) {
    return (
      <div className="flex items-center gap-2 min-w-[150px] h-9 px-4">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="min-w-[150px] justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <Favicon size={16} />
              <span>{project.name}</span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start" side="bottom">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold leading-none">{project.name}</h3>
              <p className="text-sm text-muted-foreground">
                {project.description}
              </p>
              <p className="text-xs text-accent-foreground font-mono">
                {project.domain}
              </p>
            </div>
            <Separator />
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setSettingsOpen(true);
                  setOpen(false);
                }}
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
              <Link to="/studio/team" onClick={() => setOpen(false)}>
                <Button variant="ghost" className="w-full justify-start">
                  <Users className="mr-2 h-4 w-4" />
                  Team
                </Button>
              </Link>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <ProjectSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  );
};
