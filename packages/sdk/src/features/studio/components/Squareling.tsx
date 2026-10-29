import type { PatrollerId } from "@camox/api-contract/patrol";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * What the agent is doing, as far as editors are concerned: nothing (`idle`, looking at them),
 * thinking, looking around, making changes, building its code, checking the design it built, or
 * fixing a build error.
 */
export type SquarelingStatus =
  | "idle"
  | "thinking"
  | "exploring"
  | "changing"
  | "building"
  | "checking"
  | "fixing";

/** Whether a patroller is working, as its squareling's face says. */
export type PatrollerSquarelingStatus = "idle" | "working";

type SquarelingProps = (
  | { variant?: "agent"; status: SquarelingStatus }
  | { variant: PatrollerId; status: PatrollerSquarelingStatus }
) & {
  className?: string;
  ref?: React.Ref<SVGSVGElement>;
};

/**
 * A squareling, drawn from the logo's shapes, with the knockout as eyes, looking right like the
 * mark, or at the editor while idle. Its face and motion say what it is doing. The animations
 * live in `studio.css`.
 *
 * The agent's (the default) is the logo's square with its soft corner, in emerald. Each patroller
 * has its own, one family: the Translator is the logo's wide wedge, in violet, glancing across
 * while it works; the SEO manager is a tall block with the small shape's soft corner, in amber,
 * scanning down while it works.
 *
 * One face flows into the next: its eyes glide to where the next face holds them, opening or
 * narrowing, and a looping motion settles before the next one starts (`useFaceChange`).
 */
export function Squareling(props: SquarelingProps) {
  const { status, className, ref } = props;
  const variant = props.variant ?? "agent";
  const look = LOOKS[variant];
  const body = React.useRef<SVGGElement>(null);
  // `studio.css` animates the face `data-face` names, which only `useFaceChange` changes once
  // drawn, so it can settle the face before.
  const [firstFace] = React.useState(status);
  useFaceChange(body, status);
  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      aria-hidden
      data-squareling={status}
      data-face={firstFace}
      data-squareling-variant={variant === "agent" ? undefined : variant}
      className={cn("squareling shrink-0 overflow-visible", className)}
      style={{ "--squareling-towards-us": `${towardsUs(look)}px` } as React.CSSProperties}
    >
      <g ref={body} className="squareling-body">
        <path d={look.body} className={look.fill} />
        <g className="squareling-gaze">
          <g className="squareling-eyes fill-neutral-950">
            {props.variant === undefined || props.variant === "agent" ? (
              <AgentEyes eyes={look.eyes} status={props.status} />
            ) : (
              <PatrollerEyes eyes={look.eyes} working={props.status === "working"} />
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}

/**
 * How long a looping motion takes to settle when the face changes, in ms. `studio.css` delays
 * each face's loop by as much, so it starts from rest.
 */
const SETTLE_DURATION = 300;

/**
 * Changes the face `studio.css` animates to `status`, settling the one before: the body and the
 * eyes ease from wherever their loop had them back to rest, where the next loop starts. Without
 * motion for editors who reduce it.
 */
function useFaceChange(body: React.RefObject<SVGGElement | null>, status: string) {
  React.useLayoutEffect(() => {
    const svg = body.current?.ownerSVGElement;
    if (!body.current || !svg || svg.getAttribute("data-face") === status) return;
    const moving = [
      body.current,
      ...body.current.querySelectorAll<SVGGElement>(".squareling-eyes"),
    ];
    const where = moving.map((part) => getComputedStyle(part).transform);
    svg.setAttribute("data-face", status);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [index, part] of moving.entries()) {
      const from = where[index];
      if (!from || from === "none") continue;
      part.animate([{ transform: from }, { transform: "none" }], {
        duration: SETTLE_DURATION,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
    }
  }, [body, status]);
}

/** Where a squareling's eyes sit while open: their left edges, and their top. */
type Eyes = { x: readonly [number, number]; y: number };

/**
 * A squareling's drawing: its body, the middle of its body across at its eyes, its color, and its
 * eyes.
 */
type Look = { body: string; middle: number; fill: string; eyes: Eyes };

const LOOKS: Record<"agent" | PatrollerId, Look> = {
  agent: {
    body: "M20 12H80Q88 12 88 20V64Q88 88 64 88H20Q12 88 12 80V20Q12 12 20 12Z",
    middle: 50,
    fill: "fill-emerald-500",
    eyes: { x: [50, 69], y: 36 },
  },
  // The logo's large shape: a wedge whose top is φ times its bottom, soft where the slant lands.
  translator: {
    body: "M14 14H86Q92 14 89.6 19.5L67.3 69.6Q60 86 42 86H14Q8 86 8 80V20Q8 14 14 14Z",
    // The slant narrows the wedge: at its eyes, it spans 8 to 82.
    middle: 45,
    fill: "fill-violet-500",
    eyes: { x: [40, 59], y: 28 },
  },
  // The logo's small shape, upright: soft at the top left, square elsewhere.
  seoManager: {
    body: "M20 32Q20 8 44 8H74Q80 8 80 14V86Q80 92 74 92H26Q20 92 20 86Z",
    middle: 50,
    fill: "fill-amber-500",
    eyes: { x: [44, 63], y: 28 },
  },
};

const EYE_WIDTH = 11;

/** How far the eyes move across for the squareling to look at the editor: to its face's middle. */
const towardsUs = ({ middle, eyes: { x } }: Look) => middle - (x[0] + x[1] + EYE_WIDTH) / 2;
const OPEN = 17;
const NARROWED = 6;
/** How far down a narrowed eye's middle sits, from the open one's. */
const NARROWED_SHIFT = 2.5;

/**
 * One eye, its left edge at `x` and its top at `y`: open, or narrowed on the work, lower down.
 * It narrows by scaling, which `studio.css` eases. Only an eye that blinks carries the class
 * `studio.css` blinks.
 */
function Eye({
  x,
  y,
  narrowed,
  blinks,
}: {
  x: number;
  y: number;
  narrowed: boolean;
  blinks: boolean;
}) {
  return (
    <rect
      className={cn("squareling-eye", blinks && "squareling-blinks")}
      x={x}
      y={y}
      width={EYE_WIDTH}
      height={OPEN}
      style={
        narrowed
          ? { scale: `1 ${NARROWED / OPEN}`, translate: `0 ${NARROWED_SHIFT}px` }
          : { scale: "1", translate: "0" }
      }
    />
  );
}

/**
 * The agent's eyes: both narrowed on the work while making changes, the right one while fixing,
 * open otherwise, blinking unless it looks around, makes changes, or checks the design, its eyes
 * fixed on it.
 */
function AgentEyes({ eyes, status }: { eyes: Eyes; status: SquarelingStatus }) {
  const [left, right] = eyes.x;
  const blinks = status !== "exploring" && status !== "changing" && status !== "checking";
  return (
    <>
      <Eye x={left} y={eyes.y} narrowed={status === "changing"} blinks={blinks} />
      <Eye
        x={right}
        y={eyes.y}
        narrowed={status === "changing" || status === "fixing"}
        blinks={blinks}
      />
    </>
  );
}

/** A patroller's eyes: open while idle, narrowed on the work while working. */
function PatrollerEyes({ eyes, working }: { eyes: Eyes; working: boolean }) {
  return eyes.x.map((x) => <Eye key={x} x={x} y={eyes.y} narrowed={working} blinks />);
}
