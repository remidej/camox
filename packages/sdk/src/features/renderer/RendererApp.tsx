import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import * as React from "react";
import { createPortal } from "react-dom";

import type { CamoxApp } from "../../core/createApp";
import { ContentEditsContext } from "../../core/editing/contentEdits";
import { ArtifactsRunContext, ArtifactStudioContext } from "../../core/hooks/useArtifactHost";
import { EditableSurfaceContext } from "../../core/hooks/useIsEditable";
import { reads, useRead } from "../../lib/studio-reads";
import { ViewLocaleContext } from "../../lib/view-locale-context";
import { CanvasWorkspaceContext } from "../canvas/canvasZoom";
import { type LocationState, NavigationProvider } from "../navigation/navigation";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { BlockPeek } from "../preview/components/BlockPeek";
import { FrameContext } from "../preview/components/Frame";
import { EditablePageContent } from "../preview/EditablePageContent";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { StudioNoticeContext } from "../preview/studioNotice";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import type { RendererFrame, StudioConnection } from "./studioConnection";

/**
 * The renderer document's app: it renders the page of each frame the studio gives it into that
 * frame's slot, with the site's code, and tells the studio how it went. It never draws any of
 * the studio: the studio keeps its overlays, sidebars and Canvas.
 *
 * `codeLoaded` settles once the site's code loaded: each frame waits for it, and code that fails
 * to load fails each frame, as a page that throws does.
 */
export function RendererApp({
  connection,
  camoxApp,
  codeLoaded,
  projectUuid,
  runtimeBasePath,
}: {
  connection: StudioConnection;
  camoxApp: CamoxApp;
  codeLoaded?: Promise<void>;
  projectUuid: string;
  runtimeBasePath: string;
}) {
  const frames = React.useSyncExternalStore(
    connection.subscribe,
    connection.frames,
    connection.frames,
  );
  const thumbnails = React.useSyncExternalStore(
    connection.subscribe,
    connection.thumbnails,
    connection.thumbnails,
  );
  // The studio writes every edit the pages make: they never write content themselves. It shows
  // what they tell the editor too.
  return (
    <ContentEditsContext value={connection.edit}>
      <StudioNoticeContext value={(notice) => connection.notify(notice)}>
        {frames.map((frame) =>
          createPortal(
            <RendererFrameContent
              frame={frame}
              connection={connection}
              camoxApp={camoxApp}
              codeLoaded={codeLoaded}
              projectUuid={projectUuid}
              runtimeBasePath={runtimeBasePath}
            />,
            frame.slot,
            frame.frameId,
          ),
        )}
        {thumbnails.map(({ thumbnailId, slot, blockType }) =>
          createPortal(
            <RendererThumbnail slot={slot} blockType={blockType} camoxApp={camoxApp} />,
            slot,
            thumbnailId,
          ),
        )}
      </StudioNoticeContext>
    </ContentEditsContext>
  );
}

/** A block's thumbnail, rendered by the draft's code into its frame: nothing for a block it lacks. */
function RendererThumbnail({
  slot,
  blockType,
  camoxApp,
}: {
  slot: HTMLElement;
  blockType: string;
  camoxApp: CamoxApp;
}) {
  const frameWindow = slot.ownerDocument.defaultView;
  const frameContext = React.useMemo(
    () => ({
      window: frameWindow,
      iframeElement: (frameWindow?.frameElement as HTMLIFrameElement | null) ?? null,
    }),
    [frameWindow],
  );
  // A thumbnail is no page and has no router: its fields read a location of their own, and it
  // never navigates.
  return (
    <NavigationProvider location={THUMBNAIL_LOCATION} navigate={noNavigation}>
      <FrameContext.Provider value={frameContext}>
        {/* A block whose code fails shows no thumbnail, and takes no page down with it. */}
        <ThumbnailErrorBoundary>
          <React.Suspense fallback={null}>
            <ThumbnailBlock blockType={blockType} camoxApp={camoxApp} />
          </React.Suspense>
        </ThumbnailErrorBoundary>
      </FrameContext.Provider>
    </NavigationProvider>
  );
}

const THUMBNAIL_LOCATION: LocationState = { href: "", pathname: "/", search: "", hash: "" };
const noNavigation = () => {};

class ThumbnailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Camox: a block's thumbnail failed to render.", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ThumbnailBlock({ blockType, camoxApp }: { blockType: string; camoxApp: CamoxApp }) {
  const block =
    camoxApp.getBlockById(blockType) ??
    (camoxApp.canLoadMoreBlocks() ? React.use(camoxApp.loadBlock(blockType)) : undefined);
  return block ? <BlockPeek block={block} /> : null;
}

function locationOf(href: string): LocationState {
  const url = new URL(href);
  return { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash };
}

/** One frame's page, with what the studio says of the frame around it. */
function RendererFrameContent({
  frame: { frameId, slot, target },
  connection,
  camoxApp,
  codeLoaded,
  projectUuid,
  runtimeBasePath,
}: {
  frame: RendererFrame;
  connection: StudioConnection;
  camoxApp: CamoxApp;
  codeLoaded?: Promise<void>;
  projectUuid: string;
  runtimeBasePath: string;
}) {
  const frameWindow = slot.ownerDocument.defaultView;
  const frameElement = (frameWindow?.frameElement as HTMLIFrameElement | null) ?? null;
  const location = React.useMemo(() => locationOf(target.href), [target.href]);
  // The studio follows the page's navigations, unless its frame never navigates.
  const navigate = React.useCallback(
    ({ to }: { to: string }) => connection.send({ type: "navigate", frameId, to }),
    [connection, frameId],
  );
  const workspaceKey = target.canvas?.workspaceKey;
  const workspace = React.useMemo(
    () =>
      workspaceKey === undefined
        ? null
        : {
            workspaceKey,
            // The studio paints its camera itself: no page element is outside its frame.
            mirrorCamera: () => () => {},
            reveal: (element: Element, immediate = false) =>
              connection.send({ type: "reveal", frameId, element, immediate }),
          },
    [workspaceKey, connection, frameId],
  );
  const frameContext = React.useMemo(
    () => ({ window: frameWindow, iframeElement: frameElement }),
    [frameWindow, frameElement],
  );
  const failed = React.useCallback(
    (message: string) => connection.send({ type: "error", frameId, message }),
    [connection, frameId],
  );
  const rendered = React.useCallback(
    () => connection.send({ type: "rendered", frameId }),
    [connection, frameId],
  );

  const content = (
    <NavigationProvider location={location} navigate={navigate}>
      <FrameContext.Provider value={frameContext}>
        <PreviewEditingOwnerContext value={target.owner}>
          <CanvasWorkspaceContext value={workspace}>
            <EditableSurfaceContext value={target.editable}>
              <ArtifactsRunContext value={target.artifactsRun}>
                <ArtifactStudioContext value={target.artifactStudio}>
                  <React.Activity mode={target.resting ? "hidden" : "visible"}>
                    <FrameErrorBoundary key={target.pathname} onError={failed}>
                      <React.Suspense fallback={<div role="status">Loading page…</div>}>
                        <FramePage
                          camoxApp={camoxApp}
                          codeLoaded={codeLoaded}
                          projectUuid={projectUuid}
                          runtimeBasePath={runtimeBasePath}
                          pathname={target.pathname}
                          derivedLayoutId={target.derivedLayoutId}
                          onRendered={rendered}
                        />
                      </React.Suspense>
                    </FrameErrorBoundary>
                  </React.Activity>
                </ArtifactStudioContext>
              </ArtifactsRunContext>
            </EditableSurfaceContext>
          </CanvasWorkspaceContext>
        </PreviewEditingOwnerContext>
      </FrameContext.Provider>
    </NavigationProvider>
  );
  return target.locale ? (
    <ViewLocaleContext value={target.locale}>{content}</ViewLocaleContext>
  ) : (
    content
  );
}

/** The page at `pathname`, as the runtime renders it in the renderer's draft. */
function FramePage({
  camoxApp,
  codeLoaded,
  projectUuid,
  runtimeBasePath,
  pathname,
  derivedLayoutId,
  onRendered,
}: {
  camoxApp: CamoxApp;
  codeLoaded?: Promise<void>;
  projectUuid: string;
  runtimeBasePath: string;
  pathname: string;
  derivedLayoutId?: string;
  onRendered: () => void;
}) {
  const input = useRead(
    reads.canvasFrame({
      projectUuid,
      runtimeBasePath,
      pathname,
      ...(derivedLayoutId && { derivedLayoutId }),
    }),
  );
  if (codeLoaded) React.use(codeLoaded);
  const rendered = React.useEffectEvent(onRendered);
  React.useEffect(() => rendered(), [input]);
  return (
    <HydrationBoundary state={input.dehydratedState as DehydratedState}>
      <PreviewDocumentContext.Provider value={input.previewDocument}>
        {input.derived ? (
          <DerivedPageContent camoxApp={camoxApp} derived={input.derived} />
        ) : (
          <EditablePageContent />
        )}
      </PreviewDocumentContext.Provider>
    </HydrationBoundary>
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ERROR_STYLE: React.CSSProperties = {
  padding: "24px",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  color: "#b91c1c",
};

/**
 * Contains an error the page throws while rendering to its own frame, which says so, and tells
 * the studio. The studio and every other frame keep working.
 */
class FrameErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (message: string) => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: messageOf(error) };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(messageOf(error));
  }
  render() {
    if (this.state.error === null) return this.props.children;
    // The site's styles may be what failed: the notice brings its own.
    return (
      <div role="alert" data-camox-renderer-error style={ERROR_STYLE}>
        <p style={{ margin: 0, fontWeight: 600 }}>This page couldn’t render.</p>
        <p style={{ margin: "8px 0 0", fontFamily: "ui-monospace, monospace" }}>
          {this.state.error}
        </p>
      </div>
    );
  }
}
