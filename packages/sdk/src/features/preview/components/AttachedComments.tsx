import { Button } from "@camox/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@camox/ui/input-group";
import { useSelector } from "@xstate/store-react";
import { ArrowUp, X } from "lucide-react";
import * as React from "react";

import { useAuthContext } from "@/lib/auth";

import {
  type CommentTarget,
  previewCommentsStore,
  revealCommentTarget,
} from "../previewCommentsStore";
import { previewStore } from "../previewStore";
import { CommentHeader } from "./CommentHeader";
import { CommentTargetQuote } from "./CommentTargetQuote";
import { SidebarSection, SidebarSectionHeader, SidebarSectionContent } from "./SidebarSection";

function resizeComposer(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

/** Shared comment list and composer for editors and the Feedback sidebar. */
export function AttachedComments({
  pageId,
  blockId,
  itemId,
  fieldName,
  fieldType,
  allPageComments = false,
}: {
  pageId?: number;
  blockId?: number;
  itemId?: number;
  fieldName?: string;
  fieldType?: CommentTarget["fieldType"];
  allPageComments?: boolean;
}) {
  const { authClient } = useAuthContext();
  const { data: session } = authClient.useSession();
  const { comments, draft, activeId, focusTarget } = useSelector(
    previewCommentsStore,
    (state) => state.context,
  );
  const matches = (entry: { pageId: number; target: CommentTarget }) =>
    entry.pageId === pageId &&
    (allPageComments ||
      (entry.target.blockId === blockId &&
        entry.target.itemId === itemId &&
        entry.target.fieldName === fieldName));
  const attached = comments.filter(matches);
  const currentDraft = draft && matches(draft) ? draft : null;
  const selected = attached.find((comment) => comment.id === activeId);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const activeComment = React.useRef<HTMLDivElement>(null);
  const draftTarget = currentDraft?.target;
  const message = currentDraft?.message ?? "";

  React.useLayoutEffect(() => {
    if (textarea.current) resizeComposer(textarea.current);
  }, [message, pageId]);

  React.useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resizeComposer(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pageId]);

  const submit = () => {
    if (!message.trim()) return;
    previewCommentsStore.send({
      type: "postComment",
      id: crypto.randomUUID(),
      author: { name: session?.user.name || "You", image: session?.user.image ?? null },
      createdAt: Date.now(),
    });
    textarea.current?.focus({ preventScroll: true });
  };

  React.useEffect(() => {
    if (!draftTarget || focusTarget !== draftTarget || !textarea.current) return;
    textarea.current?.scrollIntoView({ block: "nearest" });
    textarea.current?.focus({ preventScroll: true });
    previewCommentsStore.send({ type: "composerFocused" });
  }, [draftTarget, focusTarget]);

  React.useEffect(() => {
    if (!selected) return;
    activeComment.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (pageId == null) return null;

  return (
    <SidebarSection
      aria-label={
        allPageComments
          ? "Feedback"
          : blockId == null
            ? "Page comments"
            : fieldName
              ? `Comments on ${fieldName}`
              : itemId == null
                ? "Block comments"
                : "Item comments"
      }
      divider={allPageComments ? "none" : "top"}
    >
      {allPageComments ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Feedback</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="End comment mode"
            onClick={() => previewStore.send({ type: "setCommentMode", enabled: false })}
          >
            <X className="text-muted-foreground" />
          </Button>
        </div>
      ) : (
        <SidebarSectionHeader>Feedback</SidebarSectionHeader>
      )}
      <SidebarSectionContent>
        {allPageComments && attached.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No feedback yet. Select something on the page to comment on it.
          </p>
        )}
        {attached.map((comment) => (
          <div
            key={comment.id}
            ref={comment.id === activeId ? activeComment : undefined}
            {...(allPageComments && {
              role: "button",
              tabIndex: 0,
              className:
                "hover:bg-card focus-visible:ring-ring rounded-md p-1 outline-none focus-visible:ring-2",
              onClick: () => {
                previewCommentsStore.send({ type: "selectComment", id: comment.id });
                revealCommentTarget(comment.target);
              },
              onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.currentTarget.click();
              },
            })}
          >
            <CommentHeader author={comment.author} createdAt={comment.createdAt} />
            <div className="pl-8">
              {allPageComments && <CommentTargetQuote pageId={pageId} target={comment.target} />}
              <p className="text-sm wrap-break-word whitespace-pre-wrap">{comment.message}</p>
            </div>
          </div>
        ))}
        {allPageComments && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={attached.length === 0}
          >
            Send feedback to agent...
          </Button>
        )}
        {!allPageComments && (
          <InputGroup>
            <InputGroupTextarea
              ref={textarea}
              aria-label="Comment text"
              placeholder="Add a comment"
              className="block field-sizing-fixed min-h-0 flex-none overflow-hidden leading-6"
              rows={1}
              value={message}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                event.stopPropagation();
                submit();
              }}
              onChange={(event) => {
                if (!currentDraft) {
                  const fieldId = [blockId, itemId, fieldName]
                    .filter((part) => part != null)
                    .join("__");
                  previewCommentsStore.send({
                    type: "startComment",
                    pageId,
                    target: {
                      blockId,
                      itemId,
                      fieldName,
                      fieldType,
                      selector:
                        blockId == null
                          ? "body"
                          : fieldName != null
                            ? `[data-camox-field-id="${CSS.escape(fieldId)}"]`
                            : itemId != null
                              ? `[data-camox-repeater-item-id="${itemId}"]`
                              : `[data-camox-block-id="${blockId}"]`,
                      label:
                        blockId == null
                          ? `Page · ${pageId}`
                          : fieldName != null
                            ? `Field · ${fieldName}`
                            : itemId != null
                              ? `Item · ${itemId}`
                              : `Block · ${blockId}`,
                      x: 0.5,
                      y: 0.5,
                    },
                  });
                }
                previewCommentsStore.send({ type: "setMessage", message: event.target.value });
              }}
            />
            <InputGroupAddon align="block-end" className="justify-end">
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="default"
                className="rounded-full"
                aria-label="Post comment"
                disabled={!message.trim()}
                onClick={submit}
              >
                <ArrowUp size={16} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
      </SidebarSectionContent>
    </SidebarSection>
  );
}
