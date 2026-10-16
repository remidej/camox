import { useSuspenseQuery } from "@tanstack/react-query";
import * as React from "react";
import { createPortal } from "react-dom";

import type { Block } from "../../core/createBlock";
import { BlockEditingRuntimeProvider } from "../../core/editing/BlockEditingRuntime";
import { ArtifactStudioContext } from "../../core/hooks/useArtifactHost";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { blockQueries } from "../../lib/queries";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import { canvasDocumentStyles, canvasPageHref } from "./canvasFrameDocument";
import { useCanvasFrameMode, type CanvasFrameMode } from "./canvasFrameMode";
import { CanvasFrameProviders, preventLinkNavigation, useCanvasFrame } from "./useCanvasFrame";
import { useCanvasNearness } from "./useCanvasNearness";

/** World-space height reserved for a frame until it mounts and measures its block. */
const PLACEHOLDER_HEIGHT = 400;
/** Block Catalog blocks render as on the website, but on the Canvas and never editable. */
const CATALOG_ARTIFACT_STUDIO = { editMode: false, canvas: true };

export interface CanvasBlockFrameProps {
  block: Block;
  /** The project whose shared content Synced Blocks show. */
  projectId: number;
  runtimeBasePath: string;
  width: number;
  viewportHeight: number;
  /** Whether the block is selected, which keeps its frame live. */
  selected: boolean;
  /** Interacting with the block selects it. */
  onSelect: () => void;
}

/**
 * A live frame of the Block Catalog: one block with its default content, or a
 * Synced Block's shared content when the project has some, bare and
 * interactive, but with no editing. It mounts once it comes near the
 * Canvas viewport and stays mounted, so its state survives panning away,
 * though it only runs while selected and the camera is still.
 */
export function CanvasBlockFrame(props: CanvasBlockFrameProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { near, reached } = useCanvasNearness(ref);
  const mode = useCanvasFrameMode({ near, selected: props.selected });
  const previewDocument = React.useContext(PreviewDocumentContext);
  // The site document is that of the selected Page, so it changes on every
  // navigation. Only a change of the site's styles rebuilds the frame, which
  // reloads it and resets the block's state.
  const styles = React.useMemo(
    () => (reached ? canvasDocumentStyles(previewDocument) : ""),
    [reached, previewDocument],
  );
  return (
    <div ref={ref}>
      {reached ? (
        <BlockFrame key={styles} {...props} previewDocument={previewDocument} mode={mode} />
      ) : (
        <div data-canvas-block-placeholder style={{ height: PLACEHOLDER_HEIGHT }} />
      )}
    </div>
  );
}

function BlockFrame({
  block,
  projectId,
  runtimeBasePath,
  width,
  viewportHeight,
  onSelect,
  previewDocument,
  mode,
}: CanvasBlockFrameProps & { previewDocument: string | undefined; mode: CanvasFrameMode }) {
  // Kept for the frame's lifetime: the parent rebuilds the frame when the site's styles change.
  const [initialPreviewDocument] = React.useState(previewDocument);
  const [href] = React.useState(() =>
    canvasPageHref({ runtimeBasePath, pathname: "/", href: window.location.href }),
  );
  const { iframeRef, mount, iframeProps } = useCanvasFrame({
    previewDocument: initialPreviewDocument,
    href,
    width,
    viewportHeight,
    fit: "content",
    subject: "block",
    mode,
  });
  const { title, synced } = block._internal;

  return (
    <>
      {iframeProps.srcDoc && (
        <iframe
          {...iframeProps}
          title={`Block preview: ${title}`}
          style={{ display: "block", width, height: viewportHeight, border: 0 }}
        />
      )}
      {mount &&
        createPortal(
          // The Canvas runs inside the editing runtime; catalog blocks render
          // as on the live website instead, with no editing affordances.
          <BlockEditingRuntimeProvider runtime={null}>
            <ArtifactStudioContext value={CATALOG_ARTIFACT_STUDIO}>
              <CanvasFrameProviders
                pathname="/"
                href={href}
                mount={mount}
                iframe={iframeRef.current}
              >
                <React.Activity mode={mode === "resting" ? "hidden" : "visible"}>
                  <div
                    style={{ display: "flow-root" }}
                    onPointerDownCapture={onSelect}
                    onFocusCapture={onSelect}
                    onClick={preventLinkNavigation}
                  >
                    <React.Suspense fallback={<div role="status">Loading block…</div>}>
                      {synced ? (
                        <SyncedBlockContent block={block} projectId={projectId} />
                      ) : (
                        <DefaultBlockContent block={block} />
                      )}
                    </React.Suspense>
                  </div>
                </React.Activity>
              </CanvasFrameProviders>
            </ArtifactStudioContext>
          </BlockEditingRuntimeProvider>,
          mount,
        )}
    </>
  );
}

function DefaultBlockContent({ block }: { block: Block }) {
  const bundle = React.useMemo(() => block._internal.getPeekBundle(), [block]);
  return (
    <BlockContent
      block={block}
      files={bundle.files}
      repeatableItems={bundle.repeatableItems}
      blockData={{
        _id: bundle.block.id,
        type: bundle.block.type,
        content: bundle.block.content,
        settings: bundle.block.settings,
        position: bundle.block.position,
      }}
    />
  );
}

/** A Synced Block shows the project's shared content, or its defaults until it has some. */
function SyncedBlockContent({ block, projectId }: { block: Block; projectId: number }) {
  const { data: shared } = useSuspenseQuery(
    blockQueries.getSyncedContent(projectId, block._internal.id),
  );
  if (!shared) return <DefaultBlockContent block={block} />;
  return (
    <BlockContent
      block={block}
      files={shared.files}
      repeatableItems={shared.repeatableItems}
      references={[shared.block]}
      blockData={{
        _id: shared.block.id,
        type: shared.block.type,
        content: shared.block.content as Record<string, unknown>,
        settings: shared.block.settings as Record<string, unknown> | undefined,
        position: shared.block.position,
      }}
    />
  );
}

function BlockContent({
  block,
  files,
  repeatableItems,
  references,
  blockData,
}: {
  block: Block;
  /** Blocks whose resolved references the content links to. */
  references?: React.ComponentProps<typeof NormalizedDataProvider>["blocks"];
  blockData: React.ComponentProps<Block["_internal"]["Component"]>["blockData"];
} & Pick<React.ComponentProps<typeof NormalizedDataProvider>, "files" | "repeatableItems">) {
  const { id, Component } = block._internal;
  return (
    <BlockErrorBoundary blockId={blockData._id} blockType={id}>
      <NormalizedDataProvider files={files} repeatableItems={repeatableItems} blocks={references}>
        <Component blockData={blockData} mode="peek" />
      </NormalizedDataProvider>
    </BlockErrorBoundary>
  );
}
