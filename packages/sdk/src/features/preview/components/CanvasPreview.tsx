import { toast } from "@camox/ui/toaster";
import * as React from "react";

import { PreviewPreparationContext } from "../previewPreparation";
import { ViewportContinuity, ViewportContinuityContext } from "../viewportContinuity";
import { PreviewActivationContext } from "./PreviewActivation";

const loadCanvas = () =>
  import("../../canvas/CamoxCanvas").then((module) => ({ default: module.CamoxCanvas }));

class CanvasBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

type Preparation = {
  enabled: boolean;
  pathname: string;
  attempt: number;
  phase: "preparing" | "ready" | "failed";
};

// Capture the outgoing DOM before React removes frames or changes their geometry.
class ViewportHandoff extends React.Component<{
  enabled: boolean;
  canvasVisible: boolean;
  pathname: string;
  continuity: ViewportContinuity;
  children: React.ReactNode;
}> {
  getSnapshotBeforeUpdate(previous: Readonly<ViewportHandoff["props"]>) {
    const { continuity, enabled, pathname } = this.props;
    if (previous.enabled !== enabled) {
      if (enabled || previous.canvasVisible) continuity.transition(enabled, previous.pathname);
      else continuity.pendingCanvas = null; // Cancelled preparation retains the original preview.
    }
    if (previous.pathname !== pathname) continuity.navigate(pathname);
    return null;
  }

  componentDidUpdate() {}

  render() {
    return this.props.children;
  }
}

function usePreparationToast(
  enabled: boolean,
  attempt: number,
  phase: Preparation["phase"],
  retry: () => void,
) {
  const completion = React.useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const id = `studio-preparation-${crypto.randomUUID()}`;
    let active = true;
    let resolve!: () => void;
    const promise = new Promise<void>((done, reject) => {
      resolve = done;
      completion.current = { resolve: done, reject };
    });
    toast.promise(promise, {
      id,
      loading: "Loading Studio...",
      // Omitting success makes Sonner dismiss the loading toast on resolution.
      error: () => ({
        message: "Could not load studio.",
        duration: Infinity,
        action: { label: "Retry", onClick: retry },
      }),
      finally: () => {
        // A rejection may have been queued just before cancellation/unmount.
        if (!active) toast.dismiss(id);
      },
    });
    return () => {
      active = false;
      resolve();
      completion.current = null;
      toast.dismiss(id);
    };
  }, [enabled, attempt, retry]);

  React.useEffect(() => {
    if (phase === "ready") completion.current?.resolve();
    if (phase === "failed") completion.current?.reject(new Error("Studio preparation failed"));
  }, [enabled, attempt, phase]);
}

/**
 * Suspense handles module loading; the selected frame signals document/content
 * readiness. Keep the same read-only tree mounted until both have finished.
 */
export function CanvasPreview({
  enabled,
  pathname,
  runtimeBasePath,
  children,
}: {
  enabled: boolean;
  pathname: string;
  runtimeBasePath: string;
  children: React.ReactNode;
}) {
  const [continuity] = React.useState(() => new ViewportContinuity());
  const [preparation, setPreparation] = React.useState<Preparation>({
    enabled,
    pathname,
    attempt: 0,
    phase: "preparing",
  });
  // Invalidate old callbacks before rendering a new attempt. Once visible, route
  // changes belong to the existing workspace rather than another startup.
  if (
    preparation.enabled !== enabled ||
    (preparation.phase !== "ready" && preparation.pathname !== pathname)
  ) {
    setPreparation({
      enabled,
      pathname,
      attempt: preparation.attempt + 1,
      phase: "preparing",
    });
  }
  const { attempt, phase } = preparation;
  const activeAttempt = React.useRef({ attempt, enabled });
  React.useLayoutEffect(() => {
    activeAttempt.current = { attempt, enabled };
  }, [attempt, enabled]);
  const retry = React.useCallback(() => {
    setPreparation((current) => {
      if (!current.enabled || current.attempt !== attempt || current.phase !== "failed")
        return current;
      return { ...current, attempt: current.attempt + 1, phase: "preparing" };
    });
  }, [attempt]);
  usePreparationToast(enabled, attempt, phase, retry);
  const ready = enabled && phase === "ready";
  const activatePreview = React.useContext(PreviewActivationContext);
  React.useLayoutEffect(() => {
    if (ready) activatePreview?.();
  }, [ready, activatePreview]);

  const signals = React.useMemo(
    () => ({
      ready: () => {
        if (!activeAttempt.current.enabled || activeAttempt.current.attempt !== attempt) return;
        continuity.restoreCanvas();
        setPreparation((current) => {
          if (!current.enabled || current.attempt !== attempt || current.phase !== "preparing")
            return current;
          return { ...current, phase: "ready" };
        });
      },
      fail: (_error: Error) => {
        setPreparation((current) => {
          if (!current.enabled || current.attempt !== attempt || current.phase !== "preparing")
            return current;
          return { ...current, phase: "failed" };
        });
      },
    }),
    [attempt, continuity],
  );
  // React.lazy remembers a rejected import. A retry needs a fresh lazy instance
  // as well as a fresh error boundary, not a reload of the outgoing page.
  const Canvas = React.useMemo(() => React.lazy(loadCanvas), [attempt]);
  const onFatalError = React.useCallback(
    (_error: Error) => {
      setPreparation((current) => {
        if (!current.enabled || current.attempt !== attempt) return current;
        return {
          ...current,
          pathname,
          // After readiness the original promise has resolved. A later fatal
          // error needs its own promise toast so Retry is still available.
          attempt: current.phase === "ready" ? current.attempt + 1 : current.attempt,
          phase: "failed",
        };
      });
    },
    [attempt, pathname],
  );

  return (
    <ViewportContinuityContext value={continuity}>
      <ViewportHandoff
        enabled={enabled}
        canvasVisible={ready}
        pathname={pathname}
        continuity={continuity}
      >
        <div className="relative flex min-h-0 flex-1 flex-col" data-preview-surface>
          {!ready && (
            <div className="flex min-h-0 flex-1 flex-col" data-read-only-preview>
              {children}
            </div>
          )}
          {enabled && phase !== "failed" && (
            <div
              key={attempt}
              className="absolute inset-0 flex min-h-0 flex-col"
              data-canvas-preparation={phase}
              aria-hidden={!ready}
              inert={!ready}
              // Keep real geometry for iframe sizing and the camera, without exposing
              // even site content that explicitly sets visibility: visible.
              style={{ opacity: ready ? 1 : 0, pointerEvents: ready ? undefined : "none" }}
            >
              <CanvasBoundary onError={onFatalError}>
                <PreviewPreparationContext value={signals}>
                  <React.Suspense fallback={null}>
                    <Canvas runtimeBasePath={runtimeBasePath} />
                  </React.Suspense>
                </PreviewPreparationContext>
              </CanvasBoundary>
            </div>
          )}
        </div>
      </ViewportHandoff>
    </ViewportContinuityContext>
  );
}
