import type { Comment, CommentTarget } from "@camox/api-contract";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@camox/ui/avatar";
import * as React from "react";

import { usePageComments } from "../preview/usePageComments";
import { useSelectComment } from "../preview/useSelectComment";
import { MAX_CANVAS_ZOOM, type CanvasPoint } from "./canvasCamera";
import type { CanvasOverlayTarget } from "./canvasOverlayGeometry";
import { useCanvasZoom, useCanvasZoomAt } from "./canvasZoom";

// Overlay controls stay screen-sized while page geometry scales.
const COMMENT_GROUP_SCREEN_DISTANCE = { x: 72, y: 40 };
const COMMENT_AVATAR_GROUP_LIMIT = 3;

export type CanvasCommentIndicator = {
  key: string;
  comment: Comment & { target: CommentTarget };
  synced: boolean;
  x: number;
  y: number;
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
  if (target.kind === "item") return "repeater item";
  return target.kind;
}

export function canvasCommentIndicators(
  comments: Comment[],
  targets: CanvasOverlayTarget[],
): CanvasCommentIndicator[] {
  const anchors = new Map<string, { target: CanvasOverlayTarget; index: number }[]>();
  targets.forEach((target, index) => {
    if (!target.visible) return;
    const { element } = target;
    const keys: string[] = [];
    const fieldId = element.getAttribute("data-camox-field-id");
    if (fieldId) keys.push(`field:${fieldId}`);
    const blockId = element.getAttribute("data-camox-block-id");
    if (blockId) keys.push(`block:${blockId}`);
    const itemId = element.getAttribute("data-camox-repeater-item-id");
    const ownerId = element.closest("[data-camox-block-id]")?.getAttribute("data-camox-block-id");
    if (itemId && ownerId) keys.push(`item:${ownerId}:${itemId}`);
    for (const key of keys) {
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
      x: anchor.bounds.x + anchor.bounds.width,
      y: anchor.bounds.y,
    }));
  });
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
      key: members.map((indicator) => indicator.key).join(","),
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
}: {
  indicator: CanvasCommentIndicator;
  onSelect: (comment: Comment) => void;
}) {
  const { comment } = indicator;
  return (
    <button
      type="button"
      data-canvas-overlay-control
      data-canvas-comment={comment.id}
      className="focus-visible:ring-ring block size-8 rounded-full outline-none focus-visible:ring-2"
      aria-label={`View comment from ${comment.author.name} on ${commentTargetLabel(comment.target)}`}
      title={comment.message}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(comment);
      }}
    >
      <CommentIndicatorAvatar comment={comment} />
    </button>
  );
}

export function CanvasCommentIndicators({
  comments,
  targets,
  zoom = 1,
  onZoom,
  onSelect,
  placement = "preview",
}: {
  comments: Comment[];
  targets: CanvasOverlayTarget[];
  zoom?: number;
  onZoom?: (point: CanvasPoint, scale: number) => void;
  onSelect: (comment: Comment) => void;
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
          <CommentButton indicator={group.indicators[0]!} onSelect={onSelect} />
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
            className="focus-visible:ring-ring relative block h-8 rounded-full bg-[var(--camox-overlay-color-selected)] p-1 shadow-md outline-none focus-visible:ring-2"
            aria-label={`View ${group.indicators.length} comments on ${commentTargetLabel(group.indicators[0]!.comment.target)}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(group.indicators[0]!.comment);
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
          className="focus-visible:ring-ring relative block size-8 rounded-full outline-none focus-visible:ring-2"
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
  placement,
}: CanvasPageCommentIndicatorsProps) {
  const comments = usePageComments(pageId);
  const selectComment = useSelectComment(pageId);
  const zoom = useCanvasZoom();
  const zoomAt = useCanvasZoomAt();
  return (
    <CanvasCommentIndicators
      comments={comments.data ?? []}
      targets={targets}
      placement={placement}
      zoom={zoom}
      onZoom={(point, scale) => {
        activate();
        zoomAt?.(point, scale);
      }}
      onSelect={(comment) => {
        activate();
        void selectComment(comment);
      }}
    />
  );
}, sameCommentGeometry);
