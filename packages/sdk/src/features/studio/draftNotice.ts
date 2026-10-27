import type { DraftNotice } from "../routes/pageRuntime";

/** What a member is told when the studio shows Live instead of the draft they opened. */
export function draftNoticeMessage(notice: DraftNotice): string {
  switch (notice.reason) {
    case "missing":
      return "This draft doesn't exist, so you're viewing Live.";
    case "forbidden":
      return "You can't open this draft, so you're viewing Live.";
    case "ended":
      return `${notice.endedBy.name} ${notice.outcome} this draft, so you're viewing Live.`;
  }
}
