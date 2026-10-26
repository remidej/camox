import { EMPTY_THREAD_VIEW, type TouchedBatch } from "@camox/api-contract/threads";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId, useDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { type CarriedThread, useThread } from "../../../lib/use-thread";
import { cn } from "../../../lib/utils";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";
import { FollowAgentContext } from "../followAgentContext";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadMessages } from "./ThreadMessages";

/**
 * The Agent Sidebar's Chat widget, where an editor works with Camox's agent in a thread. Elsewhere in the
 * studio it is only hidden: the studio keeps following the editor's runs there. It follows
 * where the studio is: the editor's own Live thread on Live, and the draft's thread in a draft.
 * When the Live thread starts a draft, the studio enters it with the thread.
 */
export function ChatWidget({ className }: { className?: string }) {
  return (
    <section aria-label="Chat" data-chat-widget className={cn("flex flex-col", className)}>
      {/* A card like the Content Sidebar's front one, across the page, in height, edges and type. */}
      <header
        className={cn(
          "bg-background flex h-11 min-w-0 shrink-0 items-center justify-center px-3",
          BOTTOM_CARD_EDGES,
        )}
      >
        <h2 className="truncate text-sm font-medium">Agent</h2>
      </header>
      <div className={cn("bg-background flex min-h-0 flex-1 flex-col", CARD_BODY_EDGES)}>
        <CurrentThread />
      </div>
    </section>
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
  return (
    <>
      <ThreadMessages view={view} sending={sending} />
      {error && (
        <p role="alert" className="text-destructive px-2 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={sendFollowing} onStop={stop} running={view.running} />
    </>
  );
}
