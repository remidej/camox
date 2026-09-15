import { useSelector } from "@xstate/store-react";
import * as React from "react";
import { createPortal } from "react-dom";

import type { Block } from "@/core/createBlock";
import { NormalizedDataProvider } from "@/lib/normalized-data";

import { previewStore } from "../previewStore";
import { BlockErrorBoundary } from "./BlockErrorBoundary";
import { FrameContext } from "./Frame";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "./previewStyles";

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

const ThumbnailFrame = ({ block, width }: { block: Block; width: number }) => {
  const sourceFrame = useSelector(previewStore, (state) => state.context.iframeElement);
  const [frame, setFrame] = React.useState<HTMLIFrameElement | null>(null);
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(VIEWPORT_HEIGHT);
  const bundle = React.useMemo(() => block._internal.getPeekBundle(), [block]);

  const initialize = React.useCallback(() => {
    const doc = frame?.contentDocument;
    const mount = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
    if (!doc || !mount) return;

    const source = sourceFrame?.contentDocument ?? document;
    // Copy only site styles, never scripts or the studio's styles and theme.
    doc.head.replaceChildren();
    const base = doc.createElement("base");
    base.href = source.baseURI;
    doc.head.appendChild(base);
    source.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => {
      if (isSiteStyle(style)) doc.head.appendChild(style.cloneNode(true));
    });
    if (source !== document) {
      for (const [from, to] of [
        [source.documentElement, doc.documentElement],
        [source.body, doc.body],
        [source.querySelector("[data-camox-preview-root]"), mount],
      ]) {
        if (!from || !to) continue;
        for (const attribute of Array.from(from.attributes)) {
          if (!attribute.name.startsWith("on")) to.setAttribute(attribute.name, attribute.value);
        }
      }
    }
    const reset = doc.createElement("style");
    reset.textContent = `
      html, body { margin: 0 !important; overflow: hidden !important; }
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `;
    doc.head.appendChild(reset);
    doc.body.inert = true;
    setRoot(mount);
  }, [frame, sourceFrame]);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (!content) return;
    const observer = new ResizeObserver(() => {
      setContentHeight(content.getBoundingClientRect().height);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div
      className="relative max-h-full w-full shrink-0 overflow-hidden"
      style={{ height: (contentHeight * width) / VIEWPORT_WIDTH }}
    >
      <iframe
        ref={setFrame}
        title={`${block._internal.title} preview`}
        srcDoc={EMPTY_PREVIEW_DOCUMENT}
        onLoad={initialize}
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{
          width: VIEWPORT_WIDTH,
          height: VIEWPORT_HEIGHT,
          transform: `scale(${width / VIEWPORT_WIDTH})`,
        }}
      />
      {root &&
        createPortal(
          <FrameContext.Provider
            value={{ window: frame?.contentWindow ?? null, iframeElement: frame }}
          >
            <div ref={setContent} style={{ display: "flow-root" }}>
              <BlockErrorBoundary blockId={0} blockType={block._internal.id}>
                <React.Suspense fallback={null}>
                  <NormalizedDataProvider
                    files={bundle.files}
                    repeatableItems={bundle.repeatableItems}
                  >
                    <block._internal.Component
                      blockData={{
                        _id: 0,
                        type: block._internal.id,
                        content: bundle.block.content as Record<string, unknown>,
                        settings: bundle.block.settings as Record<string, unknown> | undefined,
                        position: "",
                      }}
                      mode="peek"
                    />
                  </NormalizedDataProvider>
                </React.Suspense>
              </BlockErrorBoundary>
            </div>
          </FrameContext.Provider>,
          root,
        )}
    </div>
  );
};

export const BlockThumbnail = ({ block }: { block: Block }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const checkerSize = 8 * (1 + width / VIEWPORT_WIDTH);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    });
    const resizeObserver = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    intersectionObserver.observe(element);
    resizeObserver.observe(element);
    return () => {
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className="checkered pointer-events-none relative flex h-28 w-full items-center overflow-hidden"
      style={
        width > 0
          ? {
              backgroundSize: `${checkerSize * 2}px ${checkerSize * 2}px`,
              backgroundPosition: `0 0, 0 ${checkerSize}px, ${checkerSize}px ${-checkerSize}px, ${-checkerSize}px 0`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {isVisible && width > 0 && <ThumbnailFrame block={block} width={width} />}
    </div>
  );
};
