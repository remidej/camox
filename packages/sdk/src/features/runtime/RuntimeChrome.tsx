import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { EditModePreviewFallback } from "../preview/components/EditModePreviewFallback";
import { PreviewToolbar } from "../preview/components/PreviewToolbar";
import { previewStore, selectIsEditMode } from "../preview/previewStore";
import { ChatSidebar } from "../studio/components/ChatSidebar";
import { Navbar } from "../studio/components/Navbar";
import { EditModeFallbackContext } from "./editModeFallback";
import type { PageRenderInput } from "./runtime";

const renderEditModeFallback = ({
  derived,
  children,
}: {
  derived: boolean;
  children: ReactNode;
}) => <EditModePreviewFallback derived={derived}>{children}</EditModePreviewFallback>;

export function RuntimeChrome({
  input,
  children,
}: {
  input: PageRenderInput;
  children: ReactNode;
}) {
  const preview = !input.routeKind;
  const hidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  // A page location is the Canvas in edit mode, and the preview otherwise.
  const showChat = !preview || isEditMode;

  return (
    <>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      <div className="bg-background flex h-screen flex-col overflow-hidden">
        <div className={preview ? "max-md:hidden" : undefined} hidden={preview && hidden}>
          <Navbar isPreview={preview} />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {/* A Canvas-only location has no page to lay out while the editor loads. */}
              <EditModeFallbackContext value={input.canvasOnly ? null : renderEditModeFallback}>
                {children}
              </EditModeFallbackContext>
            </div>
            {/* Kept at a stable position, outside route Suspense and editor imports. */}
            <div hidden={!preview} className={input.derived ? undefined : "max-md:hidden"}>
              <PreviewToolbar />
            </div>
          </div>
          {/* Outside the route content, so the chat survives moving between Studio pages. */}
          {showChat && <ChatSidebar />}
        </div>
      </div>
    </>
  );
}
