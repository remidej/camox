import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";
import * as React from "react";
import { createPortal } from "react-dom";

import { NavigationProvider } from "../navigation/navigation";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { PublishedPageContent } from "../page/PublishedPageContent";
import { FrameContext } from "../preview/components/Frame";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import type { PageRenderInput } from "../runtime/runtime";
import { canvasPageHref, createCanvasDocument, observeCanvasDocument } from "./canvasFrameDocument";

const noNavigation = () => {};

export interface CanvasPageFrameProps {
  input: PageRenderInput;
  width: number;
  viewportHeight: number;
}

/**
 * Parent owns /_camox/data loading and the per-card error boundary. Must live outside the
 * editing runtime. Changing page/document remounts the isolated document and query cache.
 */
export function CanvasPageFrame(props: CanvasPageFrameProps) {
  return (
    <PageFrame
      key={`${props.input.pathname}:${props.input.source}:${props.input.previewDocument ?? ""}`}
      {...props}
    />
  );
}

function PageFrame({ input, width, viewportHeight }: CanvasPageFrameProps) {
  const camoxApp = useCamoxApp();
  const href = canvasPageHref(input);
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [failure, setFailure] = React.useState<Error | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    try {
      setSrcDoc(createCanvasDocument(input.previewDocument, href));
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }, [input.previewDocument, href]);
  React.useEffect(() => () => client.clear(), [client]);
  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    return observeCanvasDocument(iframe, mount, viewportHeight);
  }, [mount, viewportHeight, width]);
  if (failure) throw failure;

  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={input.dehydratedState as DehydratedState}>
        <NavigationProvider
          location={{ pathname: input.pathname, href, hash: "", search: "" }}
          navigate={noNavigation}
        >
          <PreviewDocumentContext.Provider value={input.previewDocument}>
            <FrameContext.Provider
              value={{
                window: mount?.ownerDocument.defaultView ?? null,
                iframeElement: iframeRef.current,
              }}
            >
              {srcDoc && (
                <iframe
                  ref={iframeRef}
                  title={`Read-only page preview: ${input.pathname}`}
                  tabIndex={-1}
                  inert
                  aria-hidden="true"
                  sandbox="allow-same-origin"
                  srcDoc={srcDoc}
                  style={{
                    display: "block",
                    width,
                    height: viewportHeight,
                    border: 0,
                    pointerEvents: "none",
                  }}
                  onLoad={() => {
                    try {
                      const doc = iframeRef.current?.contentDocument;
                      const root = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
                      if (!root) throw new Error("The page preview document has no content root.");
                      if (root === mount) return;
                      doc!.documentElement.inert = true;
                      doc!.body.inert = true;
                      root.replaceChildren();
                      setMount(root);
                    } catch (error) {
                      setFailure(error instanceof Error ? error : new Error(String(error)));
                    }
                  }}
                  onError={() => setFailure(new Error("The page preview document could not load."))}
                />
              )}
              {mount &&
                createPortal(
                  <React.Suspense fallback={<div role="status">Loading page…</div>}>
                    {input.derived ? (
                      <DerivedPageContent
                        camoxApp={camoxApp}
                        derived={input.derived}
                        source={input.source}
                      />
                    ) : (
                      <PublishedPageContent source={input.source} />
                    )}
                  </React.Suspense>,
                  mount,
                )}
            </FrameContext.Provider>
          </PreviewDocumentContext.Provider>
        </NavigationProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
