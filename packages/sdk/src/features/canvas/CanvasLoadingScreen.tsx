import { Spinner } from "@camox/ui/spinner";

/**
 * Covers where the Canvas will show while it loads, in the Canvas's own background, so the
 * Canvas appears onto it rather than replacing some version of the page. A spinner at its
 * center shows the Canvas is loading.
 */
export function CanvasLoadingScreen({ spinner = true }: { spinner?: boolean }) {
  return (
    <div data-canvas-loading className="bg-muted absolute inset-0 grid place-items-center">
      {spinner && <Spinner className="text-muted-foreground size-6" />}
    </div>
  );
}
