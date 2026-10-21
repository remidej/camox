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
            {view.messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "editor"}
                className="flex flex-col gap-4"
              >
                <ThreadMessageRow message={message} showSender={showSenders} />
                {working && index === view.messages.length - 1 && <Working />}
              </MessageScrollerItem>
            ))}
            {working && view.messages.length === 0 && <Working />}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * Shown in the last message, not after it: the scroller only brings a message the editor just
 * sent into view when it's appended last, and it arrives while the agent is already working.
 */
function Working() {
  return (
    <p role="status" className="shimmer text-muted-foreground text-sm">
      Working…
    </p>
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
        <Bubble align="end" variant="muted" className="max-w-full">
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
