import { useCallback, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DRAG_THRESHOLD = 5;

export function useMarqueeSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  onSelectionChange: (ids: Set<string>) => void,
) {
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  const startPoint = useRef<Point | null>(null);
  const isDragging = useRef(false);

  const getContainerRelativePoint = useCallback(
    (e: React.PointerEvent): Point | null => {
      const container = containerRef.current;
      if (!container) return null;
      const bounds = container.getBoundingClientRect();
      return {
        x: e.clientX - bounds.left + container.scrollLeft,
        y: e.clientY - bounds.top + container.scrollTop,
      };
    },
    [containerRef],
  );

  const computeRect = (a: Point, b: Point): Rect => ({
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const findIntersectingIds = useCallback(
    (rect: Rect) => {
      const container = containerRef.current;
      if (!container) return new Set<string>();

      const containerBounds = container.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;

      // Convert selection rect from container-scroll coords to viewport coords
      const selViewport = {
        left: rect.left - scrollLeft + containerBounds.left,
        top: rect.top - scrollTop + containerBounds.top,
        right: rect.left + rect.width - scrollLeft + containerBounds.left,
        bottom: rect.top + rect.height - scrollTop + containerBounds.top,
      };

      const ids = new Set<string>();
      const cards = container.querySelectorAll("[data-asset-id]");
      for (const card of cards) {
        const cardBounds = card.getBoundingClientRect();
        const overlaps =
          selViewport.left < cardBounds.right &&
          selViewport.right > cardBounds.left &&
          selViewport.top < cardBounds.bottom &&
          selViewport.bottom > cardBounds.top;
        if (overlaps) {
          ids.add((card as HTMLElement).dataset.assetId!);
        }
      }
      return ids;
    },
    [containerRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only left mouse button
      if (e.button !== 0) return;
      // Don't start marquee if clicking on an asset card
      if ((e.target as HTMLElement).closest("[data-asset-id]")) return;

      const point = getContainerRelativePoint(e);
      if (!point) return;

      startPoint.current = point;
      isDragging.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getContainerRelativePoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPoint.current) return;

      const point = getContainerRelativePoint(e);
      if (!point) return;

      const dx = point.x - startPoint.current.x;
      const dy = point.y - startPoint.current.y;

      if (!isDragging.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          return;
        }
        isDragging.current = true;
      }

      const rect = computeRect(startPoint.current, point);
      setSelectionRect(rect);
      onSelectionChange(findIntersectingIds(rect));
    },
    [getContainerRelativePoint, findIntersectingIds, onSelectionChange],
  );

  const didDrag = useRef(false);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!startPoint.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      didDrag.current = isDragging.current;
      startPoint.current = null;
      isDragging.current = false;
      setSelectionRect(null);
    },
    [],
  );

  return {
    selectionRect,
    didDragRef: didDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
