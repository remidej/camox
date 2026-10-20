import { EMPTY_THREAD_VIEW } from "@camox/api-contract/threads";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useThread } from "../../../lib/use-thread";
import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadMessages } from "./ThreadMessages";

/**
 * Where an editor works with Camox's agent in a thread, beside every studio page except the
 * preview. It follows where the studio is: the editor's own Live thread on Live, and the draft's
 * thread in a draft.
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
    />
  );
}

function Thread({
  apiUrl,
  projectId,
  draftId,
}: {
  apiUrl: string;
  projectId: number;
  draftId: string | null;
}) {
  const { view, working, send, error } = useThread(apiUrl, projectId, draftId);
  return (
    <>
      <ThreadMessages view={{ ...view, working }} showSenders={draftId !== null} />
      {error && (
        <p role="alert" className="text-destructive px-4 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={send} />
    </>
  );
}
