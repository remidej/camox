import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { Skeleton } from "@camox/ui/skeleton";
import { AtSign, ChevronDown, ImageIcon, Info, Settings, Users } from "lucide-react";
import * as React from "react";

import { Link } from "@/features/navigation/navigation";
import { buildFaviconUrl } from "@/features/routes/pageRuntime";
import { getApiUrl } from "@/lib/api-client";
import { AuthContext } from "@/lib/auth";
import { type Project } from "@/lib/queries";

import { version } from "../../../../package.json";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { FaviconDialog } from "./FaviconDialog";
import { SocialProfilesDialog } from "./SocialProfilesDialog";

export const Favicon = ({ project, size = 16 }: { project: Project; size?: number }) => (
  <img
    src={buildFaviconUrl(getApiUrl(), project)}
    alt=""
    className="shrink-0 object-contain"
    style={{ height: size, width: size }}
  />
);

export const ProjectMenu = () => {
  const authCtx = React.useContext(AuthContext);
  const { data: project } = useReadQuery(reads.project({ projectUuid: authCtx!.projectUuid }));
  const [isFaviconDialogOpen, setIsFaviconDialogOpen] = React.useState(false);
  const [isSocialProfilesDialogOpen, setIsSocialProfilesDialogOpen] = React.useState(false);

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
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" />}>
          <div className="flex items-center gap-2">
            <Favicon project={project} size={16} />
            <span className="select-none">{project.name}</span>
          </div>
          <ChevronDown className="shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start" side="bottom">
          <DropdownMenuItem
            render={
              <a
                href={
                  authCtx
                    ? `${authCtx.authenticationUrl}/${project.organizationSlug}/${project.slug}/overview`
                    : "#"
                }
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <Settings />
            Project settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsFaviconDialogOpen(true)}>
            <ImageIcon />
            Set favicon…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsSocialProfilesDialogOpen(true)}>
            <AtSign />
            Social profiles…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {project.organizationSlug}
            </DropdownMenuLabel>
            <DropdownMenuItem
              render={
                <a
                  href={
                    authCtx
                      ? `${authCtx.authenticationUrl}/${project.organizationSlug}/members`
                      : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Users />
              Team members
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <a
                  href={
                    authCtx
                      ? `${authCtx.authenticationUrl}/${project.organizationSlug}/settings`
                      : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Settings className="h-4 w-4" />
              Team settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link to="https://camox.dev" target="_blank" />}>
            <Info className="h-4 w-4" />
            Powered by Camox
            <span className="text-muted-foreground ml-auto">v{version}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FaviconDialog
        project={project}
        open={isFaviconDialogOpen}
        onOpenChange={setIsFaviconDialogOpen}
      />
      <SocialProfilesDialog
        project={project}
        open={isSocialProfilesDialogOpen}
        onOpenChange={setIsSocialProfilesDialogOpen}
      />
    </>
  );
};
