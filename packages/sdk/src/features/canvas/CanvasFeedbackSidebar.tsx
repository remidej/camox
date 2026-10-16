import { Button } from "@camox/ui/button";
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import * as React from "react";

import { commentQueries } from "../../lib/queries";
import { isSettledIn, useCommentDraftId } from "../preview/commentStatus";
import { AttachedComments } from "../preview/components/AttachedComments";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { previewStore } from "../preview/previewStore";
import type { CanvasPage } from "./canvasPages";

type FeedbackPage = { pageId: string; title: string };

function SiteFeedback({ pages }: { pages: readonly FeedbackPage[] }) {
  const draftId = useCommentDraftId();
  const results = useQueries({
    queries: pages.map(({ pageId }) => commentQueries.list(pageId)),
  });
  const shown = pages.filter((_page, index) => {
    const result = results[index]!;
    return result.isError || result.data?.some((comment) => !isSettledIn(comment, draftId));
  });
  if (shown.length > 0) {
    return shown.map(({ pageId, title }) => (
      <AttachedComments key={pageId} pageId={pageId} heading={title} allPageComments />
    ));
  }

  const message = results.some((result) => result.isPending)
    ? "Loading feedback…"
    : results.some((result) => result.data?.length)
      ? "No unresolved feedback."
      : "No feedback yet.";
  return (
    <p className="text-muted-foreground p-4 text-sm">
      {message} Select something on a page to comment on it.
    </p>
  );
}

/**
 * The feedback of a Page, whatever is selected on it, or of every Page
 * without one, grouped by Page.
 */
export function CanvasFeedbackSidebar({
  page,
  pages,
}: {
  page?: CanvasPage;
  pages: readonly CanvasPage[];
}) {
  const titleId = React.useId();
  const feedbackPages = pages.flatMap((entry) =>
    entry.pageId == null ? [] : [{ pageId: entry.pageId, title: entry.title }],
  );
  return (
    <aside
      aria-labelledby={titleId}
      data-canvas-feedback-sidebar
      className="bg-background flex shrink-0 flex-col border-l-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <header className="flex items-center justify-between gap-2 p-2 pl-4">
        <h2 id={titleId} className="text-base font-semibold">
          Feedback
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="End comment mode"
          onClick={() => previewStore.send({ type: "setCommentMode", enabled: false })}
        >
          <X className="text-muted-foreground" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {page?.pageId != null ? (
          <AttachedComments pageId={page.pageId} heading={page.title} allPageComments />
        ) : (
          <SiteFeedback pages={feedbackPages} />
        )}
      </div>
    </aside>
  );
}
