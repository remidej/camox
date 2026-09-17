import { Toaster } from "@camox/ui/toaster";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { AuthContext, useAuthActions } from "../../lib/auth";
import { projectQueries } from "../../lib/queries";
import { useProjectRoom } from "../../lib/use-project-room";
import { usePreviewPagesActions } from "../preview/CamoxPreview";
import { useNavbarActions } from "../studio/components/Navbar";
import { useApplyTheme, useThemeActions } from "../studio/useTheme";
import { CommandPalette, useCommandPaletteActions } from "./components/CommandPalette";
import { useAdminShortcuts } from "./useAdminShortcuts";

export function AuthenticatedCamoxProvider({ children }: { children: React.ReactNode }) {
  useAdminShortcuts();
  useCommandPaletteActions();
  useThemeActions();
  useAuthActions();
  useNavbarActions();
  usePreviewPagesActions();

  const { apiUrl, projectSlug } = React.useContext(AuthContext)!;
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  useProjectRoom(apiUrl, project?.id);

  const { resolvedTheme } = useApplyTheme();
  return (
    <>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      {children}
      <Toaster theme={resolvedTheme} />
      <CommandPalette />
    </>
  );
}
