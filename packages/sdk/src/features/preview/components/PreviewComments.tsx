import { useSelector } from "@xstate/store-react";
import { MessageCircle } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  type CommentTarget,
  previewCommentsStore,
  revealCommentTarget,
} from "../previewCommentsStore";
import { previewStore, selectIsEditMode } from "../previewStore";

type Point = { x: number; y: number };

const bubbleClassName =
  "absolute flex size-8 items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-blue-600 text-xs font-semibold text-white shadow-lg";
const bubbleTransform = "translate(0, -100%)";

/** Canvas targeting and pins only. All comment content lives in the right sidebar. */
export function PreviewComments({ pageId }: { pageId: number }) {
  const iframe = useSelector(previewStore, (state) => state.context.iframeElement);
  const editing = useSelector(previewStore, selectIsEditMode);
  const commenting = useSelector(previewStore, (state) => state.context.isCommentMode);
  const { comments, draft, activeId } = useSelector(previewCommentsStore, (state) => state.context);
  const cursorRef = React.useRef<HTMLDivElement>(null);
  const [points, setPoints] = React.useState<Record<string, Point>>({});
  const doc = iframe?.contentDocument;
  const targets = React.useMemo(
    () => [
      ...comments.filter((comment) => comment.pageId === pageId),
      ...(draft?.pageId === pageId ? [{ id: "draft", target: draft.target }] : []),
    ],
    [comments, draft, pageId],
  );

  React.useEffect(
    () => () => {
      previewStore.send({ type: "setCommentMode", enabled: false });
      previewCommentsStore.send({ type: "clearSelection" });
    },
    [],
  );

  React.useEffect(() => {
    if (!doc || !editing) return;
    const win = doc.defaultView;
    if (!win) return;
    let frame = 0;
    const measure = () => {
      const next: Record<string, Point> = {};
      for (const { id, target } of targets) {
        const element = doc.querySelector(target.selector);
        if (!element || !element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > win.innerHeight) continue;
        const point = {
          x: rect.left + rect.width * target.x,
          y: rect.top + rect.height * target.y,
        };
        // Keep nearby pins individually clickable.
        while (
          Object.values(next).some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 30)
        ) {
          point.y += 32;
        }
        next[id] = point;
      }
      setPoints((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      frame = win.requestAnimationFrame(measure);
    };
    measure();
    return () => win.cancelAnimationFrame(frame);
  }, [doc, editing, targets]);

  React.useEffect(() => {
    previewStore.send({ type: "hoverCommentTarget", target: null });
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  }, [editing, commenting]);

  React.useEffect(() => {
    if (!editing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      previewStore.send({ type: "setCommentMode", enabled: false });
    };
    doc?.addEventListener("keydown", escape);
    document.addEventListener("keydown", escape);
    return () => {
      doc?.removeEventListener("keydown", escape);
      document.removeEventListener("keydown", escape);
    };
  }, [doc, editing]);

  if (!doc || !iframe?.parentElement || !editing) return null;

  const pick = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const frameRect = iframe.getBoundingClientRect();
    const x = event.clientX - frameRect.left;
    const y = event.clientY - frameRect.top;
    const element = doc.elementFromPoint(x, y);
    const block = element?.closest("[data-camox-block-id], [data-camox-comment-block-id]");
    const field = element?.closest("[data-camox-field-id]");
    const target = field ?? block;
    if (!target) return null;
    const attribute = field
      ? "data-camox-field-id"
      : target.hasAttribute("data-camox-comment-block-id")
        ? "data-camox-comment-block-id"
        : "data-camox-block-id";
    const id = target.getAttribute(attribute)!;
    const rect = target.getBoundingClientRect();
    const parts = id.split("__");
    const blockId = Number(parts[0]);
    if (!Number.isFinite(blockId)) return null;
    return {
      hoverTarget: `${field ? "field" : "block"}:${id}`,
      target: {
        blockId,
        itemId: field && parts.length > 2 ? Number(parts[1]) : undefined,
        fieldName: field ? parts.slice(parts.length > 2 ? 2 : 1).join("__") : undefined,
        fieldType:
          field?.getAttribute("data-camox-field-type") === "image"
            ? "Image"
            : field?.getAttribute("data-camox-field-type") === "embed"
              ? "Embed"
              : field?.tagName === "A"
                ? "Link"
                : "String",
        selector: `[${attribute}="${CSS.escape(id)}"]`,
        label: field ? `Field · ${id.split("__").at(-1)}` : `Block · ${id}`,
        x: Math.max(0, Math.min(1, (x - rect.left) / (rect.width || 1))),
        y: Math.max(0, Math.min(1, (y - rect.top) / (rect.height || 1))),
      } satisfies CommentTarget,
    };
  };

  return createPortal(
    <div className="pointer-events-none absolute inset-0 z-30 font-sans" data-camox-comments>
      {commenting && (
        <div
          className="pointer-events-auto absolute inset-0 cursor-none"
          onPointerMove={(event) => {
            const rect = iframe.getBoundingClientRect();
            previewStore.send({
              type: "hoverCommentTarget",
              target: pick(event)?.hoverTarget ?? null,
            });
            // Move the composited cursor without layout changes or React renders.
            if (cursorRef.current) {
              cursorRef.current.style.transform = `translate3d(${event.clientX - rect.left}px, ${event.clientY - rect.top}px, 0) ${bubbleTransform}`;
              cursorRef.current.style.opacity = "1";
            }
          }}
          onPointerLeave={() => {
            previewStore.send({ type: "hoverCommentTarget", target: null });
            if (cursorRef.current) cursorRef.current.style.opacity = "0";
          }}
          onWheel={(event) => {
            event.stopPropagation();
            const unit =
              event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? iframe.clientHeight : 1;
            iframe.contentWindow?.scrollBy(event.deltaX * unit, event.deltaY * unit);
            previewStore.send({ type: "hoverCommentTarget", target: null });
          }}
          onClick={(event) => {
            event.stopPropagation();
            const picked = pick(event);
            if (!picked) return;
            previewCommentsStore.send({
              type: "startComment",
              pageId,
              target: picked.target,
              focusComposer: true,
            });
            revealCommentTarget(picked.target);
          }}
        />
      )}
      {commenting && (
        <div
          ref={cursorRef}
          aria-hidden="true"
          className={bubbleClassName}
          style={{
            left: 0,
            top: 0,
            opacity: 0,
            willChange: "transform",
            transform: bubbleTransform,
          }}
        >
          <MessageCircle size={15} />
        </div>
      )}
      {targets.map(({ id, target }, index) => {
        const position = points[id];
        if (!position) return null;
        const selected = id === activeId || id === "draft";
        return (
          <button
            key={id}
            type="button"
            aria-label={id === "draft" ? "New comment" : `Open comment ${index + 1}`}
            aria-pressed={selected}
            className={`${bubbleClassName} pointer-events-auto hover:bg-blue-700 ${selected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
            style={{ left: position.x, top: position.y, transform: bubbleTransform }}
            onClick={() => {
              if (id !== "draft") previewCommentsStore.send({ type: "selectComment", id });
              revealCommentTarget(target);
            }}
          >
            {id === "draft" ? <MessageCircle size={15} /> : index + 1}
          </button>
        );
      })}
    </div>,
    iframe.parentElement,
  );
}
