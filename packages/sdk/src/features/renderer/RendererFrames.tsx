import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { ArtifactsRunContext, ArtifactStudioContext } from "../../core/hooks/useArtifactHost";
import { EditableSurfaceContext } from "../../core/hooks/useIsEditable";
import { useDraftScope } from "../../lib/draft-scope";
import { RevisionsContext } from "../../lib/revisions";
import { useStudioCache } from "../../lib/studio-reads";
import { ViewLocaleContext } from "../../lib/view-locale-context";
import { CanvasWorkspaceContext } from "../canvas/canvasZoom";
import { useLocation, useNavigate } from "../navigation/navigation";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { runtimePath } from "../runtime/navigationTarget";
import {
  RENDERER_DOCUMENT_PATH,
  STUDIO_HANDLE_KEY,
  type RendererAnswer,
  type RendererFrameTarget,
  type RendererQuestion,
  type StudioHandle,
} from "./protocol";
import {
  createRendererHost,
  type FrameListener,
  type RendererHost,
  type RendererStatus,
} from "./rendererHost";

/** The Website Section's renderer host. `RendererFramesProvider` provides it. */
export const RendererHostContext = React.createContext<RendererHost | null>(null);

/** The Website Section's renderer host, once it exists, or null when the studio renders pages. */
export function useRendererHost(): RendererHost | null {
  return React.use(RendererHostContext);
}

/**
 * What the renderer frame's code answers `question`, asked again whenever another renderer
 * connects (a draft move or a reload): undefined until it answers, without a renderer, or
 * without a question.
 */
export function useRendererAnswer<Question extends RendererQuestion>(
  question: Question | null,
): RendererAnswer<Question> | undefined {
  const host = useRendererHost();
  const json = question ? JSON.stringify(question) : null;
  // Counts the renderers connected, so each new one is asked.
  const connections = React.useRef(0);
  const subscribe = React.useCallback(
    (listener: () => void) =>
      host
        ? host.subscribe(() => {
            connections.current++;
            listener();
          })
        : () => {},
    [host],
  );
  const connection = React.useSyncExternalStore(subscribe, () => connections.current);
  const [answer, setAnswer] = React.useState<{ asked: string; value: unknown }>();
  React.useEffect(() => {
    if (!host || !json) return;
    let current = true;
    host.ask(JSON.parse(json) as RendererQuestion).then(
      (value) => current && setAnswer({ asked: json, value }),
      // A question the code fails to answer has no answer: callers show what they'd show without.
      () => current && setAnswer({ asked: json, value: undefined }),
    );
    return () => {
      current = false;
    };
  }, [host, json, connection]);
  return answer && answer.asked === json ? (answer.value as RendererAnswer<Question>) : undefined;
}

/**
 * The Website Section's renderer frame: one hidden frame loading the renderer document of the
 * draft the studio views, which renders every page the section's frames show (ADR 0023).
 *
 * A renderer shows one draft. Moving to another loads another renderer document, with a cache
 * of its own. A draft the studio's first content write starts is Live plus that write, so the
 * renderer showing Live enters it instead. Each new revision of the draft shown loads it again:
 * the studio keeps the Canvas position and selection, and tells the new renderer.
 */
export function RendererFramesProvider({
  runtimeBasePath,
  children,
}: {
  runtimeBasePath: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const studioCache = useStudioCache();
  const draftScope = useDraftScope();
  const [host, setHost] = React.useState<RendererHost | null>(null);
  React.useEffect(() => {
    const created = createRendererHost({ studioCache, draftScope, queryClient });
    // oxlint-disable-next-line react/set-state-in-effect -- the host subscribes to the studio, so it lives with the effect
    setHost(created);
    return () => created.close();
  }, [studioCache, draftScope, queryClient]);
  const documentUrl = React.useCallback(
    () => draftScope.hrefFor(runtimePath(RENDERER_DOCUMENT_PATH, runtimeBasePath)),
    [draftScope, runtimeBasePath],
  );
  const [source, setSource] = React.useState(documentUrl);
  React.useEffect(
    () =>
      draftScope.subscribe(({ move }) => {
        if (move !== "started") setSource(documentUrl());
      }),
    [draftScope, documentUrl],
  );
  // How many revisions of the draft shown loaded since: each one loads another renderer document.
  const [loads, setLoads] = React.useState(0);
  const revisions = React.use(RevisionsContext);
  React.useEffect(
    () =>
      revisions?.subscribe(({ draftId }) => {
        if (draftId === draftScope.current()) setLoads((count) => count + 1);
      }),
    [revisions, draftScope],
  );
  const connect = React.useCallback(
    (frame: (HTMLIFrameElement & { [STUDIO_HANDLE_KEY]?: StudioHandle }) | null) => {
      // Set before the frame's document can run: it loads once the frame is in the document.
      if (frame && host) frame[STUDIO_HANDLE_KEY] = host.handle;
    },
    [host],
  );
  return (
    <RendererHostContext value={host}>
      {children}
      {host && (
        <iframe
          key={`${source}#${loads}`}
          ref={connect}
          src={source}
          hidden
          title="Website renderer"
          data-camox-renderer
        />
      )}
    </RendererHostContext>
  );
}

/**
 * Where the renderer renders a page, inside one of the Website Section's frames: the place a
 * frame used to render the page itself. What the frame around it says (its owner, whether it is
 * editable, its Canvas workspace, location and locale) tells the renderer how to render it.
 */
export function RendererSlot({
  pathname,
  derivedLayoutId,
  resting = false,
  onRendered,
  onFailed,
}: {
  pathname: string;
  derivedLayoutId?: string;
  resting?: boolean;
  onRendered?: () => void;
  onFailed?: (message: string) => void;
}) {
  const host = useRendererHost();
  const frameId = React.useId();
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const owner = React.use(PreviewEditingOwnerContext);
  const editable = React.use(EditableSurfaceContext);
  const artifactsRun = React.use(ArtifactsRunContext);
  const artifactStudio = React.use(ArtifactStudioContext);
  const workspace = React.use(CanvasWorkspaceContext);
  const locale = React.use(ViewLocaleContext);
  const { href } = useLocation();
  const navigate = useNavigate();
  const workspaceKey = workspace?.workspaceKey;
  const target = useSameJson<RendererFrameTarget>({
    pathname,
    href,
    ...(derivedLayoutId && { derivedLayoutId }),
    owner,
    locale,
    editable,
    artifactsRun,
    artifactStudio,
    resting,
    canvas: workspaceKey === undefined ? null : { workspaceKey },
  });
  const latest = React.useRef({ onRendered, onFailed, navigate, workspace });
  React.useLayoutEffect(() => {
    latest.current = { onRendered, onFailed, navigate, workspace };
  });
  const [hears] = React.useState<FrameListener>(() => ({
    rendered: () => latest.current.onRendered?.(),
    failed: (message) => latest.current.onFailed?.(message),
    navigate: (to) => void latest.current.navigate({ to }),
    reveal: (element, immediate) => latest.current.workspace?.reveal(element, immediate),
  }));
  React.useLayoutEffect(() => {
    if (host && slot) host.show(frameId, slot, target, hears);
  }, [host, slot, frameId, target, hears]);
  React.useLayoutEffect(() => {
    if (!host || !slot) return;
    return () => host.hide(frameId);
  }, [host, slot, frameId]);
  const status = useRendererStatus(host);
  return (
    <>
      <div ref={setSlot} data-camox-renderer-slot style={{ display: "contents" }} />
      {status === "updating" && (
        <div role="status" data-camox-renderer-updating style={NOTICE_STYLE}>
          Updating the preview…
        </div>
      )}
    </>
  );
}

/** What the studio says in a frame in place of its page, in the frame's own document. */
const NOTICE_STYLE: React.CSSProperties = {
  padding: "24px",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  color: "#71717a",
};

function useRendererStatus(host: RendererHost | null): RendererStatus | null {
  const subscribe = React.useCallback(
    (listener: () => void) => host?.subscribeStatus(listener) ?? (() => {}),
    [host],
  );
  const status = () => host?.status() ?? null;
  return React.useSyncExternalStore(subscribe, status, status);
}

/** `value`, kept while it says the same, so a re-render doesn't show the frame again. */
function useSameJson<T>(value: T): T {
  const json = JSON.stringify(value);
  return React.useMemo(() => JSON.parse(json) as T, [json]);
}
