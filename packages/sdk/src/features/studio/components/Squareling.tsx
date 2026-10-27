import type { PatrollerId } from "@camox/api-contract/patrol";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * What the agent is doing, as far as editors are concerned: nothing (`idle`, standing still),
 * thinking, acting (using its tools, or building its code), or fixing a build error.
 */
export type SquarelingStatus = "idle" | "thinking" | "acting" | "fixing";

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
 * mark. Its face and motion say what it is doing. The animations live in `studio.css`.
 *
 * The agent's (the default) is the logo's square with its soft corner, in emerald. Each patroller
 * has its own, one family: the Translator is the logo's wide wedge, in violet, glancing across
 * while it works; the SEO manager is a tall block with the small shape's soft corner, in amber,
 * scanning down while it works.
 */
export function Squareling(props: SquarelingProps) {
  const { status, className, ref } = props;
  const variant = props.variant ?? "agent";
  const look = LOOKS[variant];
  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      aria-hidden
      data-squareling={status}
      data-squareling-variant={variant === "agent" ? undefined : variant}
      className={cn("squareling shrink-0 overflow-visible", className)}
    >
      <g className="squareling-body">
        <path d={look.body} className={look.fill} />
        <g className="squareling-eyes fill-neutral-950">
          {props.variant === undefined || props.variant === "agent" ? (
            <AgentEyes eyes={look.eyes} status={props.status} />
          ) : (
            <PatrollerEyes eyes={look.eyes} working={props.status === "working"} />
          )}
        </g>
      </g>
    </svg>
  );
}

/** Where a squareling's eyes sit while open: their left edges, and their top. */
type Eyes = { x: readonly [number, number]; y: number };

const LOOKS: Record<"agent" | PatrollerId, { body: string; fill: string; eyes: Eyes }> = {
  agent: {
    body: "M20 12H80Q88 12 88 20V64Q88 88 64 88H20Q12 88 12 80V20Q12 12 20 12Z",
    fill: "fill-emerald-500",
    eyes: { x: [50, 69], y: 36 },
  },
  // The logo's large shape: a wedge whose top is φ times its bottom, soft where the slant lands.
  translator: {
    body: "M14 14H86Q92 14 89.6 19.5L67.3 69.6Q60 86 42 86H14Q8 86 8 80V20Q8 14 14 14Z",
    fill: "fill-violet-500",
    eyes: { x: [40, 59], y: 28 },
  },
  // The logo's small shape, upright: soft at the top left, square elsewhere.
  seoManager: {
    body: "M20 32Q20 8 44 8H74Q80 8 80 14V86Q80 92 74 92H26Q20 92 20 86Z",
    fill: "fill-amber-500",
    eyes: { x: [44, 63], y: 28 },
  },
};

const EYE_WIDTH = 11;
const OPEN = 17;
const NARROWED = 6;
/** How far down a narrowed eye sits, from the top of the open one. */
const NARROWED_OFFSET = 8;

/**
 * One eye, its left edge at `x` and its top at `y` while open: open, or narrowed on the work.
 * Only an eye that blinks carries the class `studio.css` blinks.
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
      className={blinks ? "squareling-eye" : undefined}
      x={x}
      y={narrowed ? y + NARROWED_OFFSET : y}
      width={EYE_WIDTH}
      height={narrowed ? NARROWED : OPEN}
    />
  );
}

/**
 * The agent's eyes: open, blinking, while idle or thinking; both narrowed while acting; the
 * right one narrowed while fixing.
 */
function AgentEyes({ eyes, status }: { eyes: Eyes; status: SquarelingStatus }) {
  const [left, right] = eyes.x;
  const blinks = status === "idle" || status === "thinking";
  return (
    <>
      <Eye x={left} y={eyes.y} narrowed={status === "acting"} blinks={blinks} />
      <Eye
        x={right}
        y={eyes.y}
        narrowed={status === "acting" || status === "fixing"}
        blinks={blinks}
      />
    </>
  );
}

/** A patroller's eyes: open while idle, narrowed on the work while working. */
function PatrollerEyes({ eyes, working }: { eyes: Eyes; working: boolean }) {
  return eyes.x.map((x) => <Eye key={x} x={x} y={eyes.y} narrowed={working} blinks />);
}
