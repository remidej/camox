import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { PreviewToolbar } from "../preview/components/PreviewToolbar";
import { StudioEditingFallback } from "../preview/components/StudioEditingFallback";
import { shownRecordPage } from "../preview/pageRecord";
import { previewStore, selectIsCanvasShown } from "../preview/previewStore";
import { ChatSidebar } from "../studio/components/ChatSidebar";
import { Navbar } from "../studio/components/Navbar";
import { FollowAgentProvider } from "../studio/FollowAgentProvider";
import { EditingFallbackContext } from "./editingFallback";
import type { PageRenderInput } from "./runtime";

const renderEditingFallback = ({ layoutPage }: { layoutPage: boolean }) => (
  <StudioEditingFallback layoutPage={layoutPage} />
);

export function RuntimeChrome({
  input,
  children,
}: {
  input: PageRenderInput;
  children: ReactNode;
}) {
  const website = !input.routeKind;
  const hidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  // The chat is part of the Canvas. A page location shows the Canvas or the Preview.
  const showChat = website && isCanvasShown;

  return (
    <FollowAgentProvider runtimeBasePath={input.runtimeBasePath} website={website}>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      <div className="bg-background flex h-screen flex-col overflow-hidden">
        <div className={website ? "max-md:hidden" : undefined} hidden={website && hidden}>
          <Navbar isWebsite={website} recordPage={shownRecordPage(input)} />
        </div>
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {/* A Canvas-only location has no page to lay out while the editor loads. */}
              <EditingFallbackContext value={input.canvasOnly ? null : renderEditingFallback}>
                {children}
              </EditingFallbackContext>
            </div>
            {/* Kept at a stable position, outside route Suspense and editor imports. */}
            <div hidden={!website} className={input.derived ? undefined : "max-md:hidden"}>
              <PreviewToolbar />
            </div>
          </div>
          {/*
           * Laid over the Canvas, which spans the row under it. Outside the route content, so
           * the chat survives leaving the Canvas. Everywhere else hides it but keeps its thread,
           * so the Preview and Studio pages follow the editor's runs too.
           */}
          <ChatSidebar hidden={!showChat} />
        </div>
      </div>
    </FollowAgentProvider>
  );
}
