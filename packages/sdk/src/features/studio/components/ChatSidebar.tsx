import { EMPTY_THREAD_VIEW } from "@camox/api-contract/threads";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useLiveThread } from "../../../lib/use-live-thread";
import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadMessages } from "./ThreadMessages";

/**
 * Where an editor works with Camox's agent in a thread, beside every studio page except the
 * preview. On Live it shows the editor's own Live thread.
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
  const onLive = useCurrentDraftId() === null;

  if (!onLive) {
    return (
      <p className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm">
        Threads in drafts are coming soon.
      </p>
    );
  }
  if (!project) {
    return (
      <>
        <ThreadMessages view={EMPTY_THREAD_VIEW} />
        <ThreadComposer disabled />
      </>
    );
  }
  // One socket per project: switching projects starts over.
  return <LiveThread key={project.id} apiUrl={apiUrl} projectId={project.id} />;
}

function LiveThread({ apiUrl, projectId }: { apiUrl: string; projectId: number }) {
  const { view, sending, send, stop, error } = useLiveThread(apiUrl, projectId);
  return (
    <>
      <ThreadMessages view={view} sending={sending} />
      {error && (
        <p role="alert" className="text-destructive px-4 pt-2 text-sm">
          {error}
        </p>
      )}
      <ThreadComposer onSend={send} onStop={stop} running={view.running} />
    </>
  );
}
