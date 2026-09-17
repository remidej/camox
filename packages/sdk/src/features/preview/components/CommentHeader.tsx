import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import * as React from "react";

import type { CommentAuthor } from "../previewCommentsStore";

export function CommentHeader({ author, createdAt }: { author: CommentAuthor; createdAt: number }) {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  const age =
    minutes < 1
      ? "now"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h`
          : `${Math.floor(minutes / 1440)}d`;
  const initials = author.name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="mb-2 flex min-w-0 items-center gap-2">
      <Avatar size="sm">
        {author.image && <AvatarImage src={author.image} alt={author.name} />}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm font-medium" title={author.name}>
        {author.name}
      </span>
      <time
        className="text-muted-foreground shrink-0 text-xs"
        dateTime={new Date(createdAt).toISOString()}
        title={new Date(createdAt).toLocaleString()}
      >
        {age}
      </time>
    </header>
  );
}
