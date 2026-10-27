import { EMPTY_THREAD_VIEW, type TouchedBatch } from "@camox/api-contract/threads";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId, useDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useThread } from "../../../lib/use-thread";
import { cn } from "../../../lib/utils";
import { useNavigate } from "../../navigation/navigation";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";
import { FollowAgentContext } from "../followAgentContext";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadMessages } from "./ThreadMessages";

/**
 * The Agent Sidebar's Chat widget, where an editor works with Camox's agent in a thread. Elsewhere in the
 * studio it is only hidden: the studio keeps following the editor's runs there. It follows
 * where the studio is: the editor's own Live thread on Live, and the draft's thread in a draft.
 * When the agent on Live hands the editor's request off to a draft, the studio that asked enters
 * it, if it still shows Live; the card the Live turn ends on opens it too.
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
  const navigate = useNavigate();
  // Only a studio still on Live enters the draft its request was handed off to.
  const enterDraft = React.useCallback(
    (started: string) => draftScope.enterStarted(started),
    [draftScope],
  );
  /** Views the same page in the draft a card names. */
  const openDraft = React.useCallback(
    (next: string) => void navigate({ to: window.location.href, draft: next }),
    [navigate],
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
      onEnterDraft={enterDraft}
      onOpenDraft={openDraft}
    />
  );
}

function Thread({
  apiUrl,
  projectId,
  draftId,
  onEnterDraft,
  onOpenDraft,
}: {
  apiUrl: string;
  projectId: number;
  draftId: string | null;
  onEnterDraft: (draftId: string) => void;
  onOpenDraft: (draftId: string) => void;
}) {
  const { view, sending, send, stop, error, touched } = useThread(apiUrl, projectId, draftId, {
    onEnterDraft,
  });
  // The studio follows what its runs touch.
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
      <ThreadMessages view={view} sending={sending} onOpenDraft={onOpenDraft} />
      {error && (
        <p role="alert" className="text-destructive px-2 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={sendFollowing} onStop={stop} running={view.running} />
    </>
  );
}
