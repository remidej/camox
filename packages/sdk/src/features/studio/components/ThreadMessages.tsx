import type { ThreadMessage, ThreadSender, ThreadView } from "@camox/api-contract/threads";
import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import { Bubble, BubbleContent } from "@camox/ui/bubble";
import { Message, MessageAvatar, MessageContent } from "@camox/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@camox/ui/message-scroller";

import { ThreadMarkdown } from "./ThreadMarkdown";

/** A thread's messages and whether the agent is working, as its view shows them. */
export function ThreadMessages({ view }: { view: ThreadView }) {
  if (view.messages.length === 0 && !view.working) {
    return (
      <p
        data-thread-empty
        className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm"
      >
        Ask Camox about your website’s content.
      </p>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="flex flex-col gap-4 p-3">
            {view.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "editor"}
              >
                <ThreadMessageRow message={message} />
              </MessageScrollerItem>
            ))}
            {view.working && (
              <p role="status" className="shimmer text-muted-foreground px-10 text-sm">
                Working…
              </p>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function ThreadMessageRow({ message }: { message: ThreadMessage }) {
  if (message.from === "agent") {
    return (
      <Message>
        <MessageAvatar>
          <AgentAvatar />
        </MessageAvatar>
        <MessageContent>
          <ThreadMarkdown text={message.text} />
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="end">
      <MessageAvatar>
        <SenderAvatar sender={message.sender} />
      </MessageAvatar>
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

function SenderAvatar({ sender }: { sender: ThreadSender }) {
  return (
    <Avatar>
      {sender.image && <AvatarImage src={sender.image} alt={sender.name} />}
      <AvatarFallback>{initials(sender.name)}</AvatarFallback>
    </Avatar>
  );
}

/** The agent's avatar: Camox's logo. */
function AgentAvatar() {
  return (
    <Avatar className="bg-background">
      <svg
        role="img"
        aria-label="Camox"
        viewBox="0 0 191.03 132"
        className="m-auto size-5"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 22.55A22.55 22.55 0 0 1 22.55 0L90.19 0A5.32 5.32 0 0 1 95.52 5.32L95.52 36.48L36.48 36.48L36.48 95.52L5.32 95.52A5.32 5.32 0 0 1 0 90.19ZM95.52 36.48L181.48 36.48A5.32 5.32 0 0 1 186.01 44.61L138.61 121.31A22.55 22.55 0 0 1 119.43 132L41.81 132A5.32 5.32 0 0 1 36.48 126.68L36.48 95.52L95.52 95.52Z"
          fill="#00BC7D"
        />
      </svg>
    </Avatar>
  );
}
