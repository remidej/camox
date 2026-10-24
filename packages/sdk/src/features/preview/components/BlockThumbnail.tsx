import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useOptionalCamoxApp } from "../../provider/components/CamoxAppContext";
import { useRendererHost } from "../../renderer/RendererFrames";
import { useEditingFrame } from "../editingFrame";
import { BlockPeek } from "./BlockPeek";
import { FrameContext } from "./Frame";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "./previewStyles";

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

const ThumbnailFrame = ({
  blockType,
  title,
  width,
}: {
  blockType: string;
  title: string;
  width: number;
}) => {
  // The site's styles, from the page being edited, or else the Studio's document.
  const sourceDocument = useEditingFrame().document;
  const [frame, setFrame] = React.useState<HTMLIFrameElement | null>(null);
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(VIEWPORT_HEIGHT);
  // Ignores stylesheet loads from an earlier initialization of the frame.
  const initialization = React.useRef(0);

  const initialize = React.useCallback(() => {
    const doc = frame?.contentDocument;
    const mount = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
    if (!doc || !mount) return;

    const source = sourceDocument ?? document;
    // Copy only site styles, never scripts or the studio's styles and theme.
    doc.head.replaceChildren();
    const base = doc.createElement("base");
    base.href = source.baseURI;
    doc.head.appendChild(base);
    // Cloned stylesheet links load again, so wait for them before rendering the block,
    // or it shows unstyled for a moment.
    const stylesheetsLoaded: Promise<unknown>[] = [];
    source.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => {
      if (!isSiteStyle(style)) return;
      const clone = style.cloneNode(true) as Element;
      if (clone.localName === "link") {
        stylesheetsLoaded.push(
          new Promise((resolve) => {
            clone.addEventListener("load", resolve, { once: true });
            clone.addEventListener("error", resolve, { once: true });
          }),
        );
      }
      doc.head.appendChild(clone);
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
    doc.body.setAttribute("inert", "");
    const generation = ++initialization.current;
    void Promise.all(stylesheetsLoaded).then(() => {
      if (initialization.current === generation) setRoot(mount);
    });
  }, [frame, sourceDocument]);

  React.useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the iframe may already have loaded before its source frame changed
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
        title={`${title} preview`}
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
              {content && <ThumbnailContent blockType={blockType} slot={content} />}
            </div>
          </FrameContext.Provider>,
          root,
        )}
    </div>
  );
};

/**
 * What the thumbnail shows: the block rendered by the renderer frame, which runs the draft's
 * code, into `slot`; without one, by the code this document has, if it has the block's.
 */
const ThumbnailContent = ({ blockType, slot }: { blockType: string; slot: HTMLElement }) => {
  const host = useRendererHost();
  const block = useOptionalCamoxApp()?.getBlockById(blockType);
  const thumbnailId = React.useId();
  React.useLayoutEffect(() => {
    if (!host) return;
    host.showThumbnail(thumbnailId, slot, blockType);
    return () => host.hideThumbnail(thumbnailId);
  }, [host, thumbnailId, slot, blockType]);
  if (host || !block) return null;
  return <BlockPeek block={block} />;
};

/** A block's thumbnail, rendered by its code: an empty frame for a block whose code isn't loaded. */
export const BlockThumbnail = ({
  blockType,
  title,
  className,
}: {
  blockType: string;
  /** The block's title, naming its frame. */
  title: string;
  className?: string;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  // The renderer frame renders any block the draft's code has; without it, only this document's.
  const host = useRendererHost();
  const block = useOptionalCamoxApp()?.getBlockById(blockType);
  const renderable = !!host || !!block;

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
      className={cn(
        "bg-muted pointer-events-none relative flex h-28 w-full items-center overflow-hidden",
        className,
      )}
      aria-hidden="true"
    >
      {renderable && isVisible && width > 0 && (
        <ThumbnailFrame blockType={blockType} title={title} width={width} />
      )}
    </div>
  );
};
