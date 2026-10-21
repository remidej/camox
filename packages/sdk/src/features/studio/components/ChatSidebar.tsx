import { EMPTY_THREAD_VIEW, type TouchedBatch } from "@camox/api-contract/threads";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId, useDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { type CarriedThread, useThread } from "../../../lib/use-thread";
import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";
import { draftLabel } from "../draftLabel";
import { FollowAgentContext } from "../followAgentContext";
import { ThreadComposer } from "./ThreadComposer";
import { type ContinuedInLink, ThreadMessages } from "./ThreadMessages";

/**
 * Where an editor works with Camox's agent in a thread, beside every studio page except the
 * preview, which only hides it: the studio keeps following the editor's runs there. It follows
 * where the studio is: the editor's own Live thread on Live, and the draft's thread in a draft.
 * When the Live thread starts a draft, the studio enters it with the thread.
 */
export function ChatSidebar({ hidden = false }: { hidden?: boolean }) {
  return (
    <aside
      aria-label="Chat"
      data-chat-sidebar
      hidden={hidden}
      className="bg-background flex shrink-0 flex-col border-l-2 max-md:hidden"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {/* Mirrors the Canvas Inspector's header across the page, in height, border and type. */}
      <header className="border-border box-content flex h-8 min-w-0 items-center gap-2 border-b px-3 py-2">
        <CamoxMark />
        <h2 className="truncate text-sm font-medium">Chat</h2>
      </header>
      <CurrentThread />
    </aside>
  );
}

/** Camox's logo, beside the heading: the agent is Camox. */
function CamoxMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 191.03 132"
      className="size-5 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 22.55A22.55 22.55 0 0 1 22.55 0L90.19 0A5.32 5.32 0 0 1 95.52 5.32L95.52 36.48L36.48 36.48L36.48 95.52L5.32 95.52A5.32 5.32 0 0 1 0 90.19ZM95.52 36.48L181.48 36.48A5.32 5.32 0 0 1 186.01 44.61L138.61 121.31A22.55 22.55 0 0 1 119.43 132L41.81 132A5.32 5.32 0 0 1 36.48 126.68L36.48 95.52L95.52 95.52Z"
        fill="#00BC7D"
      />
    </svg>
  );
}

function CurrentThread() {
  const { apiUrl, projectUuid } = React.useContext(AuthContext)!;
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
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
  const { view, sending, send, stop, error, touched } = useThread(apiUrl, projectId, draftId, {
    carried,
    onEnterDraft,
  });
  // The studio follows what its runs touch, starting with what the write that started the draft
  // touched, carried from the Live thread.
  const follow = React.use(FollowAgentContext);
  const followTouched = React.useEffectEvent((batch: TouchedBatch) => follow?.receive(batch));
  React.useEffect(() => {
    if (touched) followTouched(touched.batch);
  }, [touched]);
  // The editor's message starts a run the studio follows, even if they took over the last one.
  const sendFollowing = (text: string) => {
    follow?.resume();
    send(text);
  };
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
      <ThreadComposer onSend={sendFollowing} onStop={stop} running={view.running} />
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
