import type { Comment, CommentTarget } from "@camox/api-contract";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@camox/ui/avatar";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { AttachedComments } from "../preview/components/AttachedComments";
import { previewCommentsStore, type CommentPopover } from "../preview/previewCommentsStore";
import { usePageComments } from "../preview/usePageComments";
import { MAX_CANVAS_ZOOM, type CanvasPoint } from "./canvasCamera";
import type { CanvasOverlayTarget } from "./canvasOverlayGeometry";
import { useCanvasZoom, useCanvasZoomAt } from "./canvasZoom";

// Overlay controls stay screen-sized while page geometry scales.
const COMMENT_GROUP_SCREEN_DISTANCE = { x: 72, y: 40 };
const COMMENT_AVATAR_GROUP_LIMIT = 3;
const INDICATOR_HOVER =
  "transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100";

export type CanvasCommentIndicator = {
  key: string;
  comment: Comment & { target: CommentTarget };
  synced: boolean;
  x: number;
  y: number;
  anchor?: Element;
};

export type CanvasCommentIndicatorGroup = {
  key: string;
  indicators: CanvasCommentIndicator[];
  synced: boolean;
  x: number;
  y: number;
};

function commentTargetKey(target: CommentTarget): string {
  switch (target.kind) {
    case "page":
      return "page";
    case "block":
      return `block:${target.blockId}`;
    case "item":
      return `item:${target.blockId}:${target.itemId}`;
    case "block-field":
      return `field:${target.blockId}__${target.fieldName}`;
    case "item-field":
      return `field:${target.blockId}__${target.itemId}__${target.fieldName}`;
  }
}

function commentTargetLabel(target: CommentTarget) {
  if ("fieldName" in target) return target.fieldName;
  if (target.kind === "item") return "repeatable item";
  return target.kind;
}

export function canvasCommentIndicators(
  comments: Comment[],
  targets: CanvasOverlayTarget[],
): CanvasCommentIndicator[] {
  const anchors = new Map<string, { target: CanvasOverlayTarget; index: number }[]>();
  targets.forEach((target, index) => {
    if (!target.visible) return;
    for (const key of overlayTargetKeys(target.element)) {
      const entries = anchors.get(key) ?? [];
      entries.push({ target, index });
      anchors.set(key, entries);
    }
  });

  return comments.flatMap((comment) => {
    if (comment.resolved || !comment.target) return [];
    const target = comment.target;
    return (anchors.get(commentTargetKey(target)) ?? []).map(({ target: anchor, index }) => ({
      key: `${comment.id}:${index}`,
      comment: { ...comment, target },
      synced: anchor.synced,
      anchor: anchor.element,
      x: anchor.bounds.x + anchor.bounds.width,
      y: anchor.bounds.y,
    }));
  });
}

function overlayTargetKeys(element: Element) {
  const keys: string[] = [];
  const fieldId = element.getAttribute("data-camox-field-id");
  if (fieldId) keys.push(`field:${fieldId}`);
  const blockId = element.getAttribute("data-camox-block-id");
  if (blockId) keys.push(`block:${blockId}`);
  const itemId = element.getAttribute("data-camox-repeatable-item-id");
  const ownerId = element.closest("[data-camox-block-id]")?.getAttribute("data-camox-block-id");
  if (itemId && ownerId) keys.push(`item:${ownerId}:${itemId}`);
  return keys;
}

export function groupCanvasCommentIndicators(
  indicators: CanvasCommentIndicator[],
  distance: { x: number; y: number } = COMMENT_GROUP_SCREEN_DISTANCE,
): CanvasCommentIndicatorGroup[] {
  const parent = indicators.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]!);
    return parent[index]!;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < indicators.length; left++) {
    for (let right = left + 1; right < indicators.length; right++) {
      const a = indicators[left]!;
      const b = indicators[right]!;
      if (Math.abs(a.x - b.x) <= distance.x && Math.abs(a.y - b.y) <= distance.y) {
        union(left, right);
      }
    }
  }

  const grouped = new Map<number, CanvasCommentIndicator[]>();
  indicators.forEach((indicator, index) => {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) ?? []), indicator]);
  });
  return Array.from(grouped.values(), (members) => {
    const uniqueMembers = Array.from(
      new Map(members.map((indicator) => [indicator.comment.id, indicator])).values(),
    );
    const anchor = members.reduce((current, candidate) =>
      candidate.y < current.y || (candidate.y === current.y && candidate.x < current.x)
        ? candidate
        : current,
    );
    return {
      // Keep the popover mounted when comments are added or archived on its object.
      key: Array.from(
        new Set(
          members.map(
            (indicator) =>
              `${commentObjectKey(indicator)}${indicator.key.slice(indicator.comment.id.length)}`,
          ),
        ),
      ).join(","),
      indicators: uniqueMembers,
      synced: anchor.synced,
      x: anchor.x,
      y: anchor.y,
    };
  }).sort((left, right) => left.y - right.y || left.x - right.x);
}

export function canvasCommentGroupDistance(zoom: number) {
  return {
    x: COMMENT_GROUP_SCREEN_DISTANCE.x / zoom,
    y: COMMENT_GROUP_SCREEN_DISTANCE.y / zoom,
  };
}

function commentObjectKey(indicator: CanvasCommentIndicator) {
  return commentTargetKey(indicator.comment.target);
}

export function canvasCommentSeparationZoom(
  indicators: CanvasCommentIndicator[],
  currentZoom: number,
) {
  let separationZoom = currentZoom;
  for (let left = 0; left < indicators.length; left++) {
    for (let right = left + 1; right < indicators.length; right++) {
      const a = indicators[left]!;
      const b = indicators[right]!;
      if (commentObjectKey(a) === commentObjectKey(b)) continue;
      const horizontal =
        a.x === b.x
          ? Number.POSITIVE_INFINITY
          : COMMENT_GROUP_SCREEN_DISTANCE.x / Math.abs(a.x - b.x);
      const vertical =
        a.y === b.y
          ? Number.POSITIVE_INFINITY
          : COMMENT_GROUP_SCREEN_DISTANCE.y / Math.abs(a.y - b.y);
      separationZoom = Math.max(separationZoom, Math.min(horizontal, vertical) * 1.05);
    }
  }
  return Math.min(MAX_CANVAS_ZOOM, separationZoom);
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function CommentAvatar({ comment }: { comment: Comment }) {
  return (
    <Avatar size="sm">
      {comment.author.image && <AvatarImage src={comment.author.image} alt="" />}
      <AvatarFallback>{initials(comment.author.name)}</AvatarFallback>
    </Avatar>
  );
}

function CommentIndicatorAvatar({ comment }: { comment: Comment }) {
  return (
    <span
      data-comment-indicator-avatar
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--camox-overlay-color-selected)] p-1 shadow-md"
      aria-hidden="true"
    >
      <AvatarGroup>
        <CommentAvatar comment={comment} />
      </AvatarGroup>
    </span>
  );
}

function CommentButton({
  indicator,
  onSelect,
  ...props
}: {
  indicator: CanvasCommentIndicator;
  onSelect: (comment: Comment, anchor?: Element) => void;
} & Omit<React.ComponentProps<"button">, "onSelect">) {
  const { comment } = indicator;
  return (
    <button
      {...props}
      type="button"
      data-canvas-overlay-control
      data-canvas-comment={comment.id}
      className={`focus-visible:ring-ring block size-8 rounded-full outline-none focus-visible:ring-2 ${INDICATOR_HOVER}`}
      aria-label={`View comment from ${comment.author.name} on ${commentTargetLabel(comment.target)}`}
      title={comment.message}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(comment, indicator.anchor);
        props.onClick?.(event);
      }}
    >
      <CommentIndicatorAvatar comment={comment} />
    </button>
  );
}

function CanvasCommentPopover({
  popover,
  targets,
  placement,
}: {
  popover: CommentPopover;
  targets: CanvasOverlayTarget[];
  placement: "preview" | "header";
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const matching = targets.filter(
    (entry) =>
      entry.visible && overlayTargetKeys(entry.element).includes(commentTargetKey(popover.target)),
  );
  const anchor = matching.find((entry) => entry.element === popover.anchor) ?? matching[0];
  React.useEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const documents = new Set([
      popup.ownerDocument,
      ...targets.map((entry) => entry.element.ownerDocument),
    ]);
    // Native events from preview frames do not bubble into the studio document.
    for (const iframe of popup.ownerDocument.querySelectorAll("iframe")) {
      if (iframe.contentDocument) documents.add(iframe.contentDocument);
    }
    const dismiss = (event: Event) => {
      if (event.composedPath().includes(popup)) return;
      previewCommentsStore.send({ type: "closePopover" });
    };
    for (const document of documents) document.addEventListener("pointerdown", dismiss, true);
    return () => {
      for (const document of documents) document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [targets]);
  if (placement === "preview" && !anchor) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Comments on ${commentTargetLabel(popover.target)}`}
      data-canvas-overlay-control
      data-canvas-comment-popover
      data-canvas-overlay-scroll
      className="bg-popover text-popover-foreground ring-foreground/10 absolute z-30 max-h-[min(32rem,80vh)] w-80 touch-auto overflow-y-auto overscroll-contain rounded-lg shadow-md ring-1"
      style={{
        pointerEvents: "auto",
        // Same cached coordinates and CSS camera as the other canvas overlays.
        // No portal, viewport measurements, or scroll/animation-frame tracking.
        // Open below/end, toward the page rather than outside its right edge.
        // Clamp to the page's overlay bounds entirely in CSS.
        left:
          placement === "header"
            ? 0
            : `clamp(0px, calc(${anchor!.bounds.x + anchor!.bounds.width}px * var(--canvas-zoom, 1) - 20rem - 4px), max(0px, calc(100% - 20rem)))`,
        top:
          placement === "header"
            ? "calc(100% + 8px)"
            : `calc(${anchor!.bounds.y}px * var(--canvas-zoom, 1) + 44px)`,
        maxWidth: placement === "preview" ? "100%" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        previewCommentsStore.send({ type: "closePopover" });
      }}
    >
      <AttachedComments pageId={popover.pageId} {...popover.target} presentation="popover" />
    </div>
  );
}

export function CanvasCommentIndicators({
  comments,
  targets,
  zoom = 1,
  onZoom,
  onSelect,
  openTarget,
  placement = "preview",
}: {
  comments: Comment[];
  targets: CanvasOverlayTarget[];
  zoom?: number;
  onZoom?: (point: CanvasPoint, scale: number) => void;
  onSelect: (comment: Comment, anchor?: Element) => void;
  openTarget?: CommentTarget;
  placement?: "preview" | "header";
}) {
  const indicators =
    placement === "header"
      ? comments.flatMap((comment): CanvasCommentIndicator[] => {
          if (comment.resolved || comment.target?.kind !== "page") return [];
          return [
            {
              key: comment.id,
              comment: { ...comment, target: comment.target },
              synced: false,
              x: 0,
              y: 0,
            },
          ];
        })
      : canvasCommentIndicators(comments, targets);
  const groups = groupCanvasCommentIndicators(indicators, canvasCommentGroupDistance(zoom));
  return groups.map((group) => {
    const style: React.CSSProperties =
      placement === "header"
        ? { flexShrink: 0, display: "var(--canvas-overlays-display, block)" }
        : {
            position: "absolute",
            // Keep the inset screen-sized, just like the indicator itself.
            left: `calc(${group.x}px * var(--canvas-zoom, 1) - 4px)`,
            top: `calc(${group.y}px * var(--canvas-zoom, 1) + 4px)`,
            transform: "translateX(-100%)",
            zIndex: 20,
            pointerEvents: "auto",
          };
    if (group.indicators.length === 1) {
      return (
        <div
          key={group.key}
          data-canvas-comment-group="1"
          data-camox-overlay-mode={group.synced ? "synced" : undefined}
          style={style}
        >
          <CommentButton
            indicator={group.indicators[0]!}
            onSelect={onSelect}
            aria-haspopup="dialog"
            aria-expanded={
              openTarget != null &&
              commentTargetKey(openTarget) === commentObjectKey(group.indicators[0]!)
            }
          />
        </div>
      );
    }

    const sameObject = group.indicators.every(
      (indicator) => commentObjectKey(indicator) === commentObjectKey(group.indicators[0]!),
    );
    if (sameObject) {
      const visible = group.indicators.slice(0, COMMENT_AVATAR_GROUP_LIMIT);
      const remaining = group.indicators.length - visible.length;
      return (
        <div
          key={group.key}
          data-canvas-comment-group={group.indicators.length}
          data-camox-overlay-mode={group.synced ? "synced" : undefined}
          style={style}
        >
          <button
            type="button"
            data-canvas-overlay-control
            data-comment-capsule
            className={`focus-visible:ring-ring relative block h-8 rounded-full bg-[var(--camox-overlay-color-selected)] p-1 shadow-md outline-none focus-visible:ring-2 ${INDICATOR_HOVER}`}
            aria-haspopup="dialog"
            aria-expanded={
              openTarget != null &&
              commentTargetKey(openTarget) === commentObjectKey(group.indicators[0]!)
            }
            aria-label={`View ${group.indicators.length} comments on ${commentTargetLabel(group.indicators[0]!.comment.target)}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(group.indicators[0]!.comment, group.indicators[0]!.anchor);
            }}
          >
            <AvatarGroup data-canvas-comment-avatar-group>
              {visible.map((indicator) => (
                <CommentAvatar key={indicator.comment.id} comment={indicator.comment} />
              ))}
              {remaining > 0 && <AvatarGroupCount>+{remaining}</AvatarGroupCount>}
            </AvatarGroup>
          </button>
        </div>
      );
    }
    return (
      <div
        key={group.key}
        data-canvas-comment-group={group.indicators.length}
        data-camox-overlay-mode={group.synced ? "synced" : undefined}
        style={style}
      >
        <button
          type="button"
          data-canvas-overlay-control
          className={`focus-visible:ring-ring relative block size-8 rounded-full outline-none focus-visible:ring-2 ${INDICATOR_HOVER}`}
          aria-label={`Zoom in to separate ${group.indicators.length} nearby comments`}
          onClick={(event) => {
            event.stopPropagation();
            onZoom?.(
              { x: event.clientX, y: event.clientY },
              canvasCommentSeparationZoom(group.indicators, zoom),
            );
          }}
        >
          <CommentIndicatorAvatar comment={group.indicators[0]!.comment} />
          <span
            data-comment-count={group.indicators.length}
            className="text-primary-foreground ring-background absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-[var(--camox-overlay-color-selected)] px-1 text-[10px] leading-4 font-medium ring-2"
          >
            {group.indicators.length}
          </span>
        </button>
      </div>
    );
  });
}

type CanvasPageCommentIndicatorsProps = {
  pageId: number;
  targets: CanvasOverlayTarget[];
  activate: () => void;
  placement?: "preview" | "header";
};

function sameCommentGeometry(
  previous: CanvasPageCommentIndicatorsProps,
  next: CanvasPageCommentIndicatorsProps,
) {
  if (previous.pageId !== next.pageId || previous.activate !== next.activate) return false;
  if (previous.placement !== next.placement) return false;
  if (previous.targets.length !== next.targets.length) return false;
  return previous.targets.every(
    (target, index) =>
      target.element === next.targets[index]!.element &&
      target.bounds === next.targets[index]!.bounds &&
      target.synced === next.targets[index]!.synced &&
      target.visible === next.targets[index]!.visible,
  );
}

export const CanvasPageCommentIndicators = React.memo(function CanvasPageCommentIndicators({
  pageId,
  targets,
  activate,
  placement = "preview",
}: CanvasPageCommentIndicatorsProps) {
  const comments = usePageComments(pageId);
  const popover = useSelector(previewCommentsStore, (state) => state.context.popover);
  React.useEffect(
    () => () => {
      const current = previewCommentsStore.getSnapshot().context.popover;
      if (current?.pageId !== pageId) return;
      if ((current.target.kind === "page") !== (placement === "header")) return;
      previewCommentsStore.send({ type: "closePopover" });
    },
    [pageId, placement],
  );
  const visiblePopover =
    popover?.pageId === pageId && (popover.target.kind === "page") === (placement === "header")
      ? popover
      : null;
  const zoom = useCanvasZoom();
  const zoomAt = useCanvasZoomAt();
  return (
    <div style={{ display: placement === "header" ? "flex" : "contents", position: "relative" }}>
      <CanvasCommentIndicators
        comments={comments.data ?? []}
        targets={targets}
        placement={placement}
        zoom={zoom}
        onZoom={(point, scale) => {
          activate();
          zoomAt?.(point, scale);
        }}
        openTarget={visiblePopover?.target}
        onSelect={(comment, anchor) => {
          activate();
          if (!comment.target) return;
          previewCommentsStore.send({
            type: "openPopover",
            pageId,
            target: comment.target,
            anchor,
          });
        }}
      />
      {visiblePopover && (
        <CanvasCommentPopover
          key={commentTargetKey(visiblePopover.target)}
          popover={visiblePopover}
          targets={targets}
          placement={placement}
        />
      )}
    </div>
  );
}, sameCommentGeometry);
