import { Toaster, toast } from "@camox/ui/toaster";
import * as React from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { AuthContext, useAuthActions } from "../../lib/auth";
import { useDraftScope } from "../../lib/draft-scope";
import { createRevisions, RevisionsContext } from "../../lib/revisions";
import { reads, useReadQuery, useStudioCache } from "../../lib/studio-reads";
import { useProjectRoom } from "../../lib/use-project-room";
import { usePreviewPagesActions, useShowCanvasAction } from "../preview/CamoxPreview";
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
  useShowCanvasAction();

  const { apiUrl, projectUuid } = React.useContext(AuthContext)!;
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  const draftScope = useDraftScope();
  const studioCache = useStudioCache();
  // Say why the studio shows Live when the draft a member opened, or was in, can't be shown.
  React.useEffect(
    () => draftScope.onNotice((notice) => void toast(draftNoticeMessage(notice))),
    [draftScope],
  );
  const [revisions] = React.useState(createRevisions);
  useProjectRoom(apiUrl, project?.id, studioCache, {
    onDraftEnded(ended) {
      if (ended.draftId !== draftScope.current()) return;
      draftScope.leave(ended, { notice: true });
    },
    onRevision: (revision) => revisions.announce(revision),
  });

  const { resolvedTheme } = useApplyTheme();
  return (
    <RevisionsContext value={revisions}>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      {children}
      <Toaster theme={resolvedTheme} />
      <CommandPalette />
    </RevisionsContext>
  );
}
