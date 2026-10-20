import { EMPTY_THREAD_VIEW } from "@camox/api-contract/threads";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId, useDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { type CarriedThread, useThread } from "../../../lib/use-thread";
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
  // What the Live thread showed as the studio entered the draft it started, so the draft's
  // socket picks the same thread up without flashing empty, and sends what's still on its way.
  const [carried, setCarried] = React.useState<{ draftId: string; thread: CarriedThread }>();
  const enterDraft = React.useCallback(
    (started: string, thread: CarriedThread) => {
      // Only a studio still on Live enters it, as for a first write.
      if (draftScope.current() !== null) return;
      const { startedDraft: _, continuedIn: __, ...state } = thread.state;
      setCarried({ draftId: started, thread: { ...thread, state } });
      draftScope.enterStarted(started);
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
      carried={carried?.draftId === draftId ? carried.thread : undefined}
      onEnterDraft={enterDraft}
    />
  );
}

function Thread({
  apiUrl,
  projectId,
  draftId,
  carried,
  onEnterDraft,
}: {
  apiUrl: string;
  projectId: number;
  draftId: string | null;
  carried?: CarriedThread;
  onEnterDraft: (draftId: string, carried: CarriedThread) => void;
}) {
  const { view, sending, send, stop, error } = useThread(apiUrl, projectId, draftId, {
    carried,
    onEnterDraft,
  });
  const messages = { view, sending, showSenders: draftId !== null };
  const continuedIn = draftId === null ? view.continuedIn?.draftId : undefined;
  return (
    <>
      {continuedIn ? (
        <ContinuedInMessages {...messages} projectId={projectId} draftId={continuedIn} />
      ) : (
        <ThreadMessages {...messages} />
      )}
      {error && (
        <p role="alert" className="text-destructive px-4 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={send} onStop={stop} running={view.running} />
    </>
  );
}

/**
 * A fresh Live thread's messages, linking to the draft the editor's previous one continued in,
 * named as the drafts control names it.
 */
function ContinuedInMessages({
  projectId,
  draftId,
  ...messages
}: React.ComponentProps<typeof ThreadMessages> & { projectId: number; draftId: string }) {
  const draftScope = useDraftScope();
  const navigate = useNavigate();
  const { data: draft } = useReadQuery(reads.draft({ projectId, draftId }));
  const link: ContinuedInLink = {
    // A draft published or discarded since has no summary left: the studio says how it ended.
    label: draft ? draftLabel(draft) : "a draft",
    href: draftScope.hrefFor(window.location.href, { draft: draftId }),
    onOpen: (event) => {
      event.preventDefault();
      void navigate({ to: window.location.href, draft: draftId });
    },
  };
  return <ThreadMessages {...messages} continuedIn={link} />;
}
