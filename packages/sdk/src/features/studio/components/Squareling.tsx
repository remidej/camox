import { cn } from "@/lib/utils";

/**
 * What the agent is doing, as far as editors are concerned: nothing (`idle`, standing still),
 * thinking, acting (using its tools, or building its code), or fixing a build error.
 */
export type SquarelingStatus = "idle" | "thinking" | "acting" | "fixing";

/**
 * Camox's agent, drawn from the logo's shapes: its square, the soft corner, and the knockout as
 * eyes, looking right like the mark. Its face and motion say what the agent is doing. The
 * animations live in `studio.css`.
 */
export function Squareling({
  status,
  className,
}: {
  status: SquarelingStatus;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      data-squareling={status}
      className={cn("squareling shrink-0 overflow-visible", className)}
    >
      <g className="squareling-body">
        <path
          d="M20 12H80Q88 12 88 20V64Q88 88 64 88H20Q12 88 12 80V20Q12 12 20 12Z"
          className="fill-emerald-500"
        />
        <g className="squareling-eyes fill-neutral-950">
          {(status === "idle" || status === "thinking") && (
            <>
              <rect className="squareling-eye" x="50" y="36" width="11" height="17" />
              <rect className="squareling-eye" x="69" y="36" width="11" height="17" />
            </>
          )}
          {status === "acting" && (
            <>
              <rect x="50" y="44" width="11" height="6" />
              <rect x="69" y="44" width="11" height="6" />
            </>
          )}
          {status === "fixing" && (
            <>
              <rect x="50" y="36" width="11" height="17" />
              <rect x="69" y="44" width="11" height="6" />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}
