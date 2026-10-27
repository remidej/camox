import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import * as Tooltip from "@camox/ui/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

import { useEditingFrame } from "../editingFrame";
import { selectionHoverMessage } from "../overlayMessages";
import type { Selection } from "../previewStore";

/*
 * The sidebar's stack of views, like cards filed in a box: the Canvas, then the page, then each
 * step of the selection path, each view laid over the one before. Only the front view shows its
 * content; the views behind it show just their header, which goes back to that view.
 *
 * The cards behind lean back, narrow, and shade the further back they are, by less each step,
 * and the card in front of each casts its shadow on it. Hovering one lifts it. When the
 * selection changes, cards move rather than cut: a deeper view is laid on top, a shallower one
 * pulls the cards in front of it away, and the views on the way move into place.
 */

/** How much narrower, on each side, the header right behind the front is than the front's. */
const FIRST_STEP_INSET = 9;
/**
 * How much each step back shades a card, relative to the step in front of it. The selection
 * path collapses its middle, so the stack stays short and its steps can stay even.
 */
const STEP_FALLOFF = 0.85;
/** How much each step back narrows a header, relative to the step in front of it. */
const INSET_FALLOFF = 0.75;
/** How much each step back tilts a header, relative to the step in front of it. */
const TILT_FALLOFF = 0.65;
/** How far the header right behind the front leans back, in degrees. */
const FIRST_STEP_TILT = 4;
/**
 * How far the card right behind the front shades, in percent of black, or of white in dark mode,
 * where the background is too dark to darken.
 */
const FIRST_STEP_SHADE = 1.2;
/** How much more cards lighten in dark mode than they darken in light mode, to show as much. */
const DARK_SHADE_STRENGTH = 2.5;
/** Keeps a sidebar's cards off its sides, so their edges show. */
export const SIDEBAR_GUTTER = "px-2";

/*
 * Cards have no borders: they're lit from above, with a lighter top edge and a darker bottom
 * one, like the preview toolbar, and their shadows set them apart from what's behind.
 */

/**
 * The front card's bottom, under its header, with a soft shadow down its sides that stops short
 * of its top, so it doesn't fall on its header.
 */
export const CARD_BODY_EDGES =
  "rounded-b-lg inset-shadow-raised-bottom shadow-[0_12px_24px_-12px_rgb(0_0_0/0.14)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";

/** The bottom card's top, as it meets the top of a sidebar. */
export const BOTTOM_CARD_EDGES = "rounded-t-lg inset-shadow-raised-top";

/** A card's top, over the cards behind it. */
const CARD_TOP_EDGE = "inset-shadow-raised-top";

/**
 * How much the second card behind the front fades its name, which shows depth on dark
 * backgrounds too. The card right behind the front doesn't fade.
 */
const FIRST_STEP_FADE = 0.05;
/** How far away the eye is from the stack, in px: the less, the stronger the depth. */
const PERSPECTIVE = 900;
/** How far a hovered header lifts, in px. */
const HOVER_LIFT = 1.5;

/** Sums the steps of a falloff series, `distance` views behind the front. */
function stepSeries(first: number, distance: number, falloff = STEP_FALLOFF) {
  return (first * (1 - falloff ** distance)) / (1 - falloff);
}

/** A header's inset on each side, `distance` views behind the front. */
function stackInset(distance: number) {
  return stepSeries(FIRST_STEP_INSET, distance, INSET_FALLOFF);
}

/** Cards settle into place, without bouncing. */
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const DURATION = 260;
/** Cards are pulled away a little faster than they're laid. */
const LEAVE_EASING = "cubic-bezier(0.4, 0, 1, 1)";
const LEAVE_DURATION = 180;
/** Cards swapped at their place cross quickly. */
const SWAP_DURATION = 150;
/** How long after each other cards laid at once land, front-most last. */
const STAGGER = 25;

/*
 * Headers move with transforms and opacity alone, so the compositor moves them without
 * repainting: a header's layout (its height and inset) snaps, and its card eases between the
 * old box and the new one by scaling, and its content by sliding. Easing the layout instead
 * would lay out and repaint every card under the header, and their content, on every frame.
 */

/** How far any card shades at most, `stepSeries`' limit: a header's shade is a part of it. */
const MAX_SHADE = FIRST_STEP_SHADE / (1 - STEP_FALLOFF);

/*
 * How a card moves, by how it comes or goes relative to the front: laid on top of it or
 * pulled away from it (`front`), coming forward to it or sent behind it (`back`), or swapped
 * with the card at its place (`same`).
 *
 * Cards are opaque: one laid on top or pulled away slides whole, fading only at the far end of
 * its way, so it covers the cards it passes rather than blending with them. The card behind
 * barely moves, as the card in front of it hides it. One sent behind fades out, as the headers
 * laid over it are narrower and would show its sides.
 */
type Motion = "front" | "back" | "same";

/** How far below the front a card is laid from, or pulled away to, in px. */
const PULL = 24;
const PLACED: Keyframe = { transform: "none", opacity: 1 };
const PULLED: Keyframe = { transform: `translateY(${PULL}px)`, opacity: 0 };
const BEHIND: Keyframe = { transform: "translateY(-2px) scale(0.995)", opacity: 0.8 };

const COMING: Record<Motion, Keyframe[]> = {
  front: [PULLED, { opacity: 1, offset: 0.4 }, PLACED],
  back: [BEHIND, PLACED],
  same: [{ opacity: 0 }, { opacity: 1 }],
};
const GOING: Record<Motion, Keyframe[]> = {
  front: [PLACED, { opacity: 1, offset: 0.3 }, PULLED],
  back: [PLACED, { ...BEHIND, opacity: 0 }],
  same: [{ opacity: 1 }, { opacity: 0 }],
};
const GOING_TIMING: Record<Motion, KeyframeAnimationOptions> = {
  front: { duration: LEAVE_DURATION, easing: LEAVE_EASING },
  back: { duration: DURATION, easing: EASE },
  same: { duration: SWAP_DURATION, easing: "ease-out" },
};

function motionFor(depth: number, front: number): Motion {
  if (depth > front) return "front";
  if (depth < front) return "back";
  return "same";
}

function prefersMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type StackMotion = {
  /** Whether the stack has rendered once: cards don't move into a stack as it first shows. */
  ready: boolean;
  /** The front view's depth, once a view shows. */
  front: number | null;
  /** Where cards that leave go: behind the views, or in front of them. */
  behind: HTMLDivElement | null;
  inFront: HTMLDivElement | null;
};

const SelectionViewsContext = React.createContext<{
  count: number;
  setCount: (count: number) => void;
} | null>(null);
const StackMotionContext = React.createContext<React.RefObject<StackMotion> | null>(null);

/**
 * Wraps a stack whose selection views render apart from the views under them, so the views
 * under them know how many are laid over them. Its cards move as the stack changes.
 */
export function SidebarStack({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const motion = React.useRef<StackMotion>({
    ready: false,
    front: null,
    behind: null,
    inFront: null,
  });
  React.useLayoutEffect(() => {
    const current = motion.current;
    current.ready = true;
    // Runs before its cards' cleanups, so a stack that goes takes its cards without moving them.
    return () => {
      current.ready = false;
    };
  }, []);
  return (
    <SelectionViewsContext value={{ count, setCount }}>
      <StackMotionContext value={motion}>
        <div className={cn("relative isolate flex min-h-0 flex-1 flex-col", SIDEBAR_GUTTER)}>
          {children}
          <div
            ref={(node) => {
              motion.current.behind = node;
            }}
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          />
          <div
            ref={(node) => {
              motion.current.inFront = node;
            }}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          />
        </div>
      </StackMotionContext>
    </SelectionViewsContext>
  );
}

/** A still copy of a card, where it was, so it can move away once the card is gone. */
function copyCard(card: HTMLElement, layer: HTMLElement) {
  const layerRect = layer.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const copy = card.cloneNode(true) as HTMLElement;
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  Object.assign(copy.style, {
    position: "absolute",
    margin: "0",
    left: `${rect.left - layerRect.left}px`,
    top: `${rect.top - layerRect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  // Clones don't keep where they were scrolled to.
  const scrolled: [path: number[], top: number][] = [];
  const walk = (node: Element, path: number[]) => {
    if (node.scrollTop > 0) scrolled.push([path, node.scrollTop]);
    Array.from(node.children).forEach((child, i) => walk(child, [...path, i]));
  };
  walk(card, []);
  const restoreScroll = () => {
    for (const [path, top] of scrolled) {
      let node: Element | undefined = copy;
      for (const i of path) node = node?.children[i];
      if (node) node.scrollTop = top;
    }
  };
  return { copy, restoreScroll };
}

/**
 * Moves a card of the stack, `depth` views from its back, as it comes and goes: into place
 * from where the front was, then away relative to the new front.
 */
function useStackCard(
  ref: React.RefObject<HTMLElement | null>,
  depth: number | undefined,
  isView: boolean,
) {
  const stack = React.useContext(StackMotionContext);
  React.useLayoutEffect(() => {
    const card = ref.current;
    const motion = stack?.current;
    if (!card || !motion || depth == null) return;
    const previousFront = motion.front;
    // Cards lay out front to back, so every header sees the front from before the view.
    if (isView) motion.front = depth;
    if (motion.ready && previousFront != null && prefersMotion()) {
      const how = motionFor(depth, previousFront);
      card.animate(COMING[how], {
        duration: how === "same" ? SWAP_DURATION : DURATION,
        easing: how === "same" ? "ease-out" : EASE,
        // Cards laid at once land back to front.
        delay: how === "front" ? (depth - previousFront - 1) * STAGGER : 0,
        fill: "backwards",
      });
    }
    return () => {
      const { behind, inFront } = motion;
      if (!motion.ready || !behind || !inFront || !prefersMotion()) return;
      // Copied now, while the card is still laid out; moved once the new front is known.
      const { copy, restoreScroll } = copyCard(card, inFront);
      queueMicrotask(() => {
        // It stayed: its effect only ran again.
        if (card.isConnected) return;
        const how = motionFor(depth, motion.front ?? depth);
        (how === "front" ? inFront : behind).append(copy);
        restoreScroll();
        const leaving = copy.animate(GOING[how], { ...GOING_TIMING[how], fill: "forwards" });
        leaving.finished.then(
          () => copy.remove(),
          () => copy.remove(),
        );
      });
    };
    // A card moves as it comes and goes, not as it moves within the stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Where a header's card and content were laid out, relative to the header. */
type HeaderBox = { width: number; height: number; center: number };

/**
 * Eases a header's card and content from where they were laid out before `shape` changed to
 * where they are now, as its layout snaps: its card scales from its old size, and its content
 * slides from its old height.
 */
function useHeaderReshape(
  surfaceRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  shape: string,
) {
  const last = React.useRef<HeaderBox | null>(null);
  const moving = React.useRef<Animation[]>([]);
  React.useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const content = contentRef.current;
    if (!surface || !content) return;
    const box: HeaderBox = {
      width: surface.offsetWidth,
      height: surface.offsetHeight,
      center: content.offsetTop + content.offsetHeight / 2,
    };
    const from = last.current;
    last.current = box;
    if (!from || !box.width || !box.height || !prefersMotion()) return;
    // Changed again on its way: start from where it shows, not from where it was laid out.
    let { width, height, center } = from;
    if (moving.current.some((animation) => animation.playState === "running")) {
      const shown = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
      width *= shown.a;
      height *= shown.d;
      center += new DOMMatrixReadOnly(getComputedStyle(content).transform).f;
    }
    for (const animation of moving.current) animation.cancel();
    const timing = { duration: DURATION, easing: EASE };
    moving.current = [
      surface.animate(
        [
          { transform: `scale(${width / box.width}, ${height / box.height})` },
          { transform: "none" },
        ],
        timing,
      ),
      content.animate(
        [{ transform: `translateY(${center - box.center}px)` }, { transform: "none" }],
        timing,
      ),
    ];
    // Moves only as its shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
}

/** How many of the selection's views are laid over the page's, in this stack. */
export function useSelectionViewCount() {
  return React.useContext(SelectionViewsContext)?.count ?? 0;
}

/** Tells the stack how many views the selection lays over the page's, while it renders. */
export function SelectionViewCount({ count }: { count: number }) {
  const setCount = React.useContext(SelectionViewsContext)?.setCount;
  React.useLayoutEffect(() => {
    if (!setCount) return;
    setCount(count);
    return () => setCount(0);
  }, [setCount, count]);
  return null;
}

/**
 * A view's content, under its header, `depth` views from the back of the stack. Key it by the
 * view, so it comes and goes with the view.
 */
export function SidebarStackView({
  depth,
  className,
  children,
}: {
  depth: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useStackCard(ref, depth, true);
  // Off the sidebar's edges, in a stack, the front card is lit and casts its shadow.
  const inStack = React.useContext(StackMotionContext) != null;
  return (
    <div
      ref={ref}
      className={cn(
        "bg-background min-h-0 flex-1 origin-top",
        inStack && CARD_BODY_EDGES,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarStackHeader({
  depth,
  distance = 0,
  first = false,
  onSelect,
  hoverTarget,
  tooltip,
  popover,
  children,
}: {
  /** How many views are under this one in the stack, so it moves as it comes and goes. */
  depth?: number;
  /** How many views are laid over this one. Under any, only its header shows. */
  distance?: number;
  /** Whether it's the bottom of the stack. Outside a stack, at its front, it's flat. */
  first?: boolean;
  /** Goes back to this view, while covered. */
  onSelect?: () => void;
  /** What hovering the header highlights in the editing frame, while covered. `null` is the page. */
  hoverTarget?: Selection | null;
  tooltip?: React.ReactNode;
  /** What clicking the header opens, while covered, instead of going back to its view. */
  popover?: React.ReactNode;
  children: React.ReactNode;
}) {
  const covered = distance > 0;
  const { send } = useEditingFrame();
  const [hovered, setHovered] = React.useState(false);
  // Compared by value: the path rebuilds its targets on every render.
  const hoverKey =
    covered && hovered && hoverTarget !== undefined ? JSON.stringify(hoverTarget) : null;
  React.useEffect(() => {
    if (hoverKey == null) return;
    const target = JSON.parse(hoverKey) as Selection | null;
    send(selectionHoverMessage(target, true));
    return () => send(selectionHoverMessage(target, false));
  }, [hoverKey, send]);

  const ref = React.useRef<HTMLDivElement>(null);
  useStackCard(ref, depth, false);

  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const liftable = covered && (onSelect != null || popover != null);
  // In a stack, off the sidebar's edges, its bottom card is a card too; elsewhere it meets the edge.
  const inStack = React.useContext(StackMotionContext) != null;
  const flat = first && !covered && !inStack;
  const tilt = covered ? stepSeries(FIRST_STEP_TILT, distance, TILT_FALLOFF) : 0;
  const shade = stepSeries(FIRST_STEP_SHADE, distance);

  const button = liftable ? (
    <button
      type="button"
      className="hover:text-foreground data-popup-open:text-foreground flex h-full w-full min-w-0 cursor-pointer items-center justify-center rounded-[inherit] px-3 text-center text-(--ancestor-foreground) transition-colors focus-visible:outline-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        setHovered(false);
        onSelect?.();
      }}
    >
      <span className="truncate opacity-(--fade) transition-opacity">{children}</span>
    </button>
  ) : null;

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const inset = covered ? stackInset(distance) : 0;
  useHeaderReshape(surfaceRef, contentRef, `${covered}:${inset}`);

  return (
    // The card's place in the stack, which moves it as it comes and goes; the card in it leans.
    <div ref={ref} className={cn("relative shrink-0 origin-top", !first && "-mt-1")}>
      <div
        className={cn(
          "relative flex min-w-0 items-center justify-center text-center text-sm",
          // Ancestors' names, between muted and full, so they read without competing with the front.
          "[--ancestor-foreground:color-mix(in_oklab,var(--color-muted-foreground),var(--color-foreground)_40%)]",
          "[--fade:var(--rest-fade)] [--lift:0px] [--shade:var(--rest-shade)] [--tilt:var(--rest-tilt)]",
          "[--shade-color:black] [--shade-strength:1] dark:[--shade-color:white] dark:[--shade-strength:var(--dark-shade-strength)]",
          "origin-bottom [backface-visibility:hidden] motion-reduce:transition-none!",
          covered ? "h-[38px] pb-1" : "h-11 px-3",
          liftable &&
            "hover:[--fade:1] hover:[--lift:var(--hover-lift)] hover:[--shade:var(--hover-shade)] hover:[--tilt:var(--hover-tilt)]",
          liftable &&
            "has-focus-visible:[--fade:1] has-focus-visible:[--lift:var(--hover-lift)] has-focus-visible:[--shade:var(--hover-shade)] has-focus-visible:[--tilt:var(--hover-tilt)]",
          // Lifted while its popover is open, as when hovered.
          liftable &&
            "has-data-popup-open:[--fade:1] has-data-popup-open:[--lift:var(--hover-lift)] has-data-popup-open:[--shade:var(--hover-shade)] has-data-popup-open:[--tilt:var(--hover-tilt)]",
        )}
        style={
          {
            "--rest-tilt": `${tilt}deg`,
            "--hover-tilt": `${tilt / 2}deg`,
            "--rest-shade": shade,
            "--dark-shade-strength": DARK_SHADE_STRENGTH,
            "--hover-shade": stepSeries(FIRST_STEP_SHADE, Math.max(0, distance - 1)),
            // Lifted, the bottom card would rise past the top of the sidebar.
            "--hover-lift": `${first ? 0 : -HOVER_LIFT}px`,
            "--rest-fade": covered ? 1 - stepSeries(FIRST_STEP_FADE, distance - 1) : 1,
            transform: `perspective(${PERSPECTIVE}px) translateY(var(--lift)) rotateX(var(--tilt))`,
            transition: `transform ${DURATION}ms ${EASE}`,
          } as React.CSSProperties
        }
      >
        {/* The card itself, under the header's content. */}
        <div
          ref={surfaceRef}
          aria-hidden
          className={cn(
            "bg-background absolute inset-y-0 isolate origin-top",
            !flat && (first ? "rounded-t-lg" : "rounded-t-sm"),
            covered &&
              !first &&
              "shadow-[0_-2px_5px_-3px_rgb(0_0_0/0.08)] dark:shadow-[0_-2px_5px_-3px_rgb(0_0_0/0.4)]",
            !covered &&
              !first &&
              "shadow-[0_-3px_8px_-4px_rgb(0_0_0/0.08)] dark:shadow-[0_-3px_8px_-4px_rgb(0_0_0/0.4)]",
          )}
          style={{ insetInline: inset }}
        >
          {/* Shades the card by fading in a darker one over it, which needs no repaint. */}
          <div
            className="absolute inset-0 rounded-[inherit] motion-reduce:transition-none!"
            style={{
              backgroundColor: `color-mix(in oklab, var(--color-background), var(--shade-color) calc(${MAX_SHADE}% * var(--shade-strength)))`,
              opacity: `calc(var(--shade) / ${MAX_SHADE})`,
              transition: `opacity ${DURATION}ms ease-out`,
            }}
          />
          {/* Its lit top edge, over its shade. */}
          {!flat && <div className={cn("absolute inset-0 rounded-[inherit]", CARD_TOP_EDGE)} />}
        </div>
        <div
          ref={contentRef}
          className="relative flex min-w-0 flex-1 items-center justify-center self-stretch"
          style={{ marginInline: inset || undefined }}
        >
          {button && popover ? (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger render={button} />
              {/* Picking anything in it moves the selection, which leaves it. */}
              <PopoverContent
                side="bottom"
                // Narrower than the header under it, and further down, so their edges don't
                // nearly line up.
                sideOffset={8}
                className="w-48 gap-0 p-1"
                onClick={() => setPopoverOpen(false)}
              >
                {popover}
              </PopoverContent>
            </Popover>
          ) : button && tooltip ? (
            <Tooltip.Tooltip>
              <Tooltip.TooltipTrigger render={button} />
              <Tooltip.TooltipContent side="bottom">{tooltip}</Tooltip.TooltipContent>
            </Tooltip.Tooltip>
          ) : (
            (button ??
            (covered ? (
              <span className="truncate px-3 text-(--ancestor-foreground) opacity-(--fade)">
                {children}
              </span>
            ) : (
              children
            )))
          )}
        </div>
      </div>
    </div>
  );
}
