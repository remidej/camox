import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { PreviewToolbar } from "../preview/components/PreviewToolbar";
import { previewStore } from "../preview/previewStore";
import { Navbar } from "../studio/components/Navbar";
import type { PageRenderInput } from "./runtime";
import { SharedChromeContext } from "./SharedChromeContext";

export function RuntimeChrome({
  input,
  children,
}: {
  input: PageRenderInput;
  children: ReactNode;
}) {
  const preview = !input.routeKind;
  const hidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);

  return (
    <SharedChromeContext.Provider value={true}>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      <div className="bg-background flex h-screen flex-col overflow-hidden">
        <div className={preview ? "max-md:hidden" : undefined} hidden={preview && hidden}>
          <Navbar isPreview={preview} />
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
          {/* Kept at a stable position, outside route Suspense and editor imports. */}
          <div hidden={!preview} className={input.derived ? undefined : "max-md:hidden"}>
            <PreviewToolbar />
          </div>
        </div>
      </div>
    </SharedChromeContext.Provider>
  );
}
