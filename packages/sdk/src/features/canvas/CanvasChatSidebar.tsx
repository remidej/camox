import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";

/**
 * The Canvas's chat with an Agent, shown whatever is selected. A placeholder
 * for now: no messages, and its composer is disabled.
 */
export function CanvasChatSidebar() {
  return (
    <aside
      aria-label="Chat"
      data-canvas-chat-sidebar
      className="bg-background flex shrink-0 flex-col border-l-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <p className="p-4 text-base font-semibold">Chat</p>
      <section
        aria-label="Messages"
        className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 text-center text-sm"
      >
        Chatting with an Agent is coming soon.
      </section>
      <form className="p-2" onSubmit={(event) => event.preventDefault()}>
        <textarea
          aria-label="Message"
          placeholder="Message an Agent…"
          disabled
          rows={3}
          className="bg-muted w-full resize-none rounded-md p-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      </form>
    </aside>
  );
}
