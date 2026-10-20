import type { ThreadMessage, ThreadSender, ThreadView } from "@camox/api-contract/threads";
import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import { Bubble, BubbleContent } from "@camox/ui/bubble";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@camox/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@camox/ui/message-scroller";
import type * as React from "react";

import { ThreadMarkdown } from "./ThreadMarkdown";

/** The draft the editor's previous Live thread continued in, as a link to it. */
export type ContinuedInLink = {
  label: string;
  href: string;
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * A thread's messages, and "Working…" while a run is going or a message is still `sending`: on
 * its way to the thread, which hasn't accepted it yet. A draft's thread is shared, so it shows
 * senders' names too (`showSenders`). A fresh Live thread links to the draft the editor's
 * previous one continued in (`continuedIn`).
 */
export function ThreadMessages({
  view,
  sending = false,
  showSenders = false,
  continuedIn,
}: {
  view: ThreadView;
  sending?: boolean;
  showSenders?: boolean;
  continuedIn?: ContinuedInLink;
}) {
  const working = view.running || sending;
  if (view.messages.length === 0 && !working) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {continuedIn && <ContinuedIn link={continuedIn} />}
        <p
          data-thread-empty
          className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm"
        >
          Ask Camox about your website’s content.
        </p>
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="flex flex-col gap-4 p-3">
            {continuedIn && <ContinuedIn link={continuedIn} />}
            {view.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "editor"}
              >
                <ThreadMessageRow message={message} showSender={showSenders} />
              </MessageScrollerItem>
            ))}
            {working && (
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

function ThreadMessageRow({
  message,
  showSender,
}: {
  message: ThreadMessage;
  showSender: boolean;
}) {
  if (message.from === "stopped" || message.from === "failed") {
    return (
      <Message>
        <MessageAvatar>
          <AgentAvatar />
        </MessageAvatar>
        <MessageContent>
          <p className="text-muted-foreground text-sm">
            {message.from === "stopped"
              ? `Stopped by ${message.sender.name}`
              : "Camox couldn’t finish this. Send your message again to retry."}
          </p>
        </MessageContent>
      </Message>
    );
  }
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
        {showSender && (
          <MessageHeader className="text-muted-foreground text-xs">
            {message.sender.name}
          </MessageHeader>
        )}
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function ContinuedIn({ link }: { link: ContinuedInLink }) {
  return (
    <p className="text-muted-foreground px-4 pt-3 text-center text-sm">
      Continued in{" "}
      <a href={link.href} onClick={link.onOpen} className="text-foreground underline">
        {link.label}
      </a>
    </p>
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
