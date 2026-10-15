import { Toaster, toast } from "@camox/ui/toaster";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { AuthContext, useAuthActions } from "../../lib/auth";
import { projectQueries } from "../../lib/queries";
import { getCurrentDraftId, onDraftNotice, reportDraftNotice } from "../../lib/studio-draft";
import { useProjectRoom } from "../../lib/use-project-room";
import { useNavigate } from "../navigation/navigation";
import { usePreviewPagesActions } from "../preview/CamoxPreview";
import { useNavbarActions } from "../studio/components/Navbar";
import { draftNoticeMessage } from "../studio/draftNotice";
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
  const navigate = useNavigate();
  // Say why the studio shows Live when the draft a member opened, or was in, can't be shown.
  React.useEffect(() => onDraftNotice((notice) => void toast(draftNoticeMessage(notice))), []);
  useProjectRoom(apiUrl, project?.id, {
    onDraftEnded(ended) {
      if (ended.draftId !== getCurrentDraftId()) return;
      reportDraftNotice({ reason: "ended", ...ended });
      void navigate({ to: window.location.href, draft: null, replace: true });
    },
  });

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
