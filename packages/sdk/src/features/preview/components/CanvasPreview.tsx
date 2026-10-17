import { toast } from "@camox/ui/toaster";
import * as React from "react";

import { CanvasLoadingScreen } from "../../canvas/CanvasLoadingScreen";
import { PreviewPageFrame, PreviewPageFrameContext } from "../previewPageFrame";
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
  /** The Canvas mounted for this preparation. A new one replaces a failed Canvas. */
  instance: number;
  /**
   * Whether this Canvas was ready once. It then stays mounted, hidden, outside Edit Mode,
   * so turning Edit Mode back on shows it without loading it again.
   */
  warm: boolean;
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

/** A failed preparation offers to retry, until it is retried or Edit Mode turns off. */
function useFailureToast(failed: boolean, retry: () => void) {
  React.useEffect(() => {
    if (!failed) return;
    const id = toast.error("Could not load studio.", {
      duration: Infinity,
      action: { label: "Retry", onClick: retry },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [failed, retry]);
}

/**
 * Suspense handles module loading; the Canvas signals readiness once laid out.
 * The Preview stays mounted throughout: while the Canvas shows, its page frame
 * sits in the selected Page's slot.
 */
export function CanvasPreview({
  enabled,
  pathname,
  pagePathname,
  runtimeBasePath,
  placeholder,
  children,
}: {
  enabled: boolean;
  pathname: string;
  /** The pathname of the page the Preview page frame shows, if any. */
  pagePathname?: string;
  runtimeBasePath: string;
  /**
   * Stands where the Canvas sidebar will be while the Canvas prepares, so the sidebars
   * settle right away. The rest of the Canvas's place shows a loading screen meanwhile.
   */
  placeholder?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [continuity] = React.useState(() => new ViewportContinuity());
  const [preparation, setPreparation] = React.useState<Preparation>({
    enabled,
    pathname,
    attempt: 0,
    phase: "preparing",
    instance: 0,
    warm: false,
  });
  // Invalidate old callbacks before rendering a new attempt. Once visible, route
  // changes belong to the existing workspace rather than another startup.
  if (
    preparation.enabled !== enabled ||
    (preparation.phase !== "ready" && preparation.pathname !== pathname)
  ) {
    setPreparation({
      ...preparation,
      enabled,
      pathname,
      attempt: preparation.attempt + 1,
      phase: "preparing",
      // React.lazy remembers a rejected import, and a failed Canvas can't be shown again.
      instance: preparation.instance + (preparation.phase === "failed" ? 1 : 0),
    });
  }
  const { attempt, phase, instance, warm } = preparation;
  const activeAttempt = React.useRef({ attempt, enabled });
  React.useLayoutEffect(() => {
    activeAttempt.current = { attempt, enabled };
  }, [attempt, enabled]);
  const retry = React.useCallback(() => {
    setPreparation((current) => {
      if (!current.enabled || current.attempt !== attempt || current.phase !== "failed")
        return current;
      return {
        ...current,
        attempt: current.attempt + 1,
        phase: "preparing",
        instance: current.instance + 1,
      };
    });
  }, [attempt]);
  useFailureToast(enabled && phase === "failed", retry);
  const ready = enabled && phase === "ready";
  const activatePreview = React.useContext(PreviewActivationContext);
  React.useLayoutEffect(() => {
    if (ready) activatePreview?.();
  }, [ready, activatePreview]);

  const signals = React.useMemo(
    () => ({
      ready: (options?: { restore?: boolean }) => {
        if (!activeAttempt.current.enabled || activeAttempt.current.attempt !== attempt) return;
        if (options?.restore !== false) continuity.restoreCanvas();
        setPreparation((current) => {
          if (!current.enabled || current.attempt !== attempt || current.phase !== "preparing")
            return current;
          return { ...current, phase: "ready", warm: true };
        });
      },
      fail: (_error: Error) => {
        setPreparation((current) => {
          if (!current.enabled || current.attempt !== attempt || current.phase !== "preparing")
            return current;
          return { ...current, phase: "failed", warm: false };
        });
      },
    }),
    [attempt, continuity],
  );
  // React.lazy remembers a rejected import. A retry needs a fresh lazy instance
  // as well as a fresh error boundary, not a reload of the outgoing page.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- each Canvas instance needs its own lazy instance
  const Canvas = React.useMemo(() => React.lazy(loadCanvas), [instance]);
  const onFatalError = React.useCallback(
    (_error: Error) => {
      setPreparation((current) => {
        // A hidden warm Canvas that fails is dropped, and loads again in Edit Mode.
        if (!current.enabled) return current.warm ? { ...current, warm: false } : current;
        if (current.attempt !== attempt) return current;
        return {
          ...current,
          pathname,
          // After readiness, a later fatal error is a failure of its own, which Retry follows.
          attempt: current.phase === "ready" ? current.attempt + 1 : current.attempt,
          phase: "failed",
          warm: false,
        };
      });
    },
    [attempt, pathname],
  );

  const [pageFrame] = React.useState(() => new PreviewPageFrame());
  const pageFrameContext = React.useMemo(
    () => ({ frame: pageFrame, revealed: ready, pathname: pagePathname }),
    [pageFrame, ready, pagePathname],
  );

  return (
    <ViewportContinuityContext value={continuity}>
      <PreviewPageFrameContext value={pageFrameContext}>
        <ViewportHandoff
          enabled={enabled}
          canvasVisible={ready}
          pathname={pathname}
          continuity={continuity}
        >
          <div className="relative flex min-h-0 flex-1" data-preview-surface>
            {enabled && phase !== "failed" && placeholder}
            {/* Never unmounted: the Canvas borrows its page frame for the selected Page. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-read-only-preview>
              {children}
              {/* A warm Canvas shows within a frame or two: no spinner then. */}
              {enabled && phase === "preparing" && <CanvasLoadingScreen spinner={!warm} />}
            </div>
            {phase !== "failed" && (enabled || warm) && (
              <React.Activity key={instance} mode={enabled ? "visible" : "hidden"}>
                <div
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
                        {/* oxlint-disable-next-line react/static-components -- recreated only per instance, see above */}
                        <Canvas runtimeBasePath={runtimeBasePath} />
                      </React.Suspense>
                    </PreviewPreparationContext>
                  </CanvasBoundary>
                </div>
              </React.Activity>
            )}
          </div>
        </ViewportHandoff>
      </PreviewPageFrameContext>
    </ViewportContinuityContext>
  );
}
