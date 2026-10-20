import { EMPTY_THREAD_VIEW, type ThreadState } from "@camox/api-contract/threads";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId, useDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useThread } from "../../../lib/use-thread";
import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";
import { draftLabel } from "../draftLabel";
import { ThreadComposer } from "./ThreadComposer";
import { type ContinuedInLink, ThreadMessages } from "./ThreadMessages";

/**
 * Where an editor works with Camox's agent in a thread, beside every studio page except the
 * preview. It follows where the studio is: the editor's own Live thread on Live, and the draft's
 * thread in a draft. When the Live thread starts a draft, the studio enters it with the thread.
 */
export function ChatSidebar() {
  return (
    <aside
      aria-label="Chat"
      data-chat-sidebar
      className="bg-background flex shrink-0 flex-col border-l-2 max-md:hidden"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <p className="p-4 text-base font-semibold">Chat</p>
      <CurrentThread />
    </aside>
  );
}

function CurrentThread() {
  const { apiUrl, projectSlug } = React.useContext(AuthContext)!;
  const { data: project } = useReadQuery(reads.project({ slug: projectSlug }));
  const draftId = useCurrentDraftId();
  const draftScope = useDraftScope();
  // What the Live thread showed as it entered the draft it started, so the draft's socket picks
  // the same thread up without flashing empty.
  const [carried, setCarried] = React.useState<{ draftId: string; state: ThreadState }>();
  const enterDraft = React.useCallback(
    (started: string, { startedDraft: _entered, ...state }: ThreadState) => {
      setCarried({ draftId: started, state });
      if (!draftScope.enterStarted(started)) setCarried(undefined);
    },
    [draftScope],
  );
  // Only the move into the draft carries the thread over.
  React.useEffect(
    () =>
      draftScope.subscribe(({ move }) => {
        if (move !== "started") setCarried(undefined);
      }),
    [draftScope],
  );

  if (!project) {
    return (
      <>
        <ThreadMessages view={EMPTY_THREAD_VIEW} />
        <ThreadComposer disabled />
      </>
    );
  }
  // One socket per project and draft: switching either starts over.
  return (
    <Thread
      key={`${project.id}:${draftId ?? "live"}`}
      apiUrl={apiUrl}
      projectId={project.id}
      draftId={draftId}
      initialState={carried?.draftId === draftId ? carried.state : undefined}
      onEnterDraft={enterDraft}
    />
  );
}

function Thread({
  apiUrl,
  projectId,
  draftId,
  initialState,
  onEnterDraft,
}: {
  apiUrl: string;
  projectId: number;
  draftId: string | null;
  initialState?: ThreadState;
  onEnterDraft: (draftId: string, state: ThreadState) => void;
}) {
  const { view, sending, send, stop, error } = useThread(apiUrl, projectId, draftId, {
    initialState,
    onEnterDraft,
  });
  const continuedIn = useContinuedInLink(projectId, draftId ? undefined : view.continuedIn);
  return (
    <>
      <ThreadMessages
        view={view}
        sending={sending}
        showSenders={draftId !== null}
        continuedIn={continuedIn}
      />
      {error && (
        <p role="alert" className="text-destructive px-4 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={send} onStop={stop} running={view.running} />
    </>
  );
}

/** A link to the draft the editor's previous Live thread continued in, named as the drafts control names it. */
function useContinuedInLink(
  projectId: number,
  draftId: string | undefined,
): ContinuedInLink | undefined {
  const draftScope = useDraftScope();
  const navigate = useNavigate();
  const { data: draft } = useReadQuery(reads.draft({ projectId, draftId: draftId ?? "" }), {
    enabled: !!draftId,
  });
  if (!draftId) return undefined;
  // A draft published or discarded since has no summary left: the studio says how it ended.
  const label = draft ? draftLabel(draft) : "a draft";
  return {
    label,
    href: draftScope.hrefFor(window.location.href, { draft: draftId }),
    onOpen: (event) => {
      event.preventDefault();
      void navigate({ to: window.location.href, draft: draftId });
    },
  };
}
