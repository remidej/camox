import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@camox/ui/input-group";
import { useSelector } from "@xstate/store-react";
import { ArrowUp } from "lucide-react";
import * as React from "react";

import { useAuthContext } from "@/lib/auth";

import { type CommentTarget, previewCommentsStore } from "../previewCommentsStore";
import { CommentHeader } from "./CommentHeader";
import { SidebarSection, SidebarSectionHeader, SidebarSectionContent } from "./SidebarSection";

function resizeComposer(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

/** Comments sit alongside their existing page/block/item/field editor. */
export function AttachedComments({
  pageId,
  blockId,
  itemId,
  fieldName,
  fieldType,
}: {
  pageId?: number;
  blockId?: number;
  itemId?: number;
  fieldName?: string;
  fieldType?: CommentTarget["fieldType"];
}) {
  const { authClient } = useAuthContext();
  const { data: session } = authClient.useSession();
  const { comments, draft, activeId, focusTarget } = useSelector(
    previewCommentsStore,
    (state) => state.context,
  );
  const matches = (entry: { pageId: number; target: CommentTarget }) =>
    entry.pageId === pageId &&
    entry.target.blockId === blockId &&
    entry.target.itemId === itemId &&
    entry.target.fieldName === fieldName;
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
    if (!draftTarget || focusTarget !== draftTarget) return;
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
        blockId == null
          ? "Page comments"
          : fieldName
            ? `Comments on ${fieldName}`
            : itemId == null
              ? "Block comments"
              : "Item comments"
      }
      divider="top"
    >
      <SidebarSectionHeader>Discussions</SidebarSectionHeader>
      <SidebarSectionContent>
        {attached.map((comment) => (
          <div key={comment.id} ref={comment.id === activeId ? activeComment : undefined}>
            <CommentHeader author={comment.author} createdAt={comment.createdAt} />
            <p className="text-sm wrap-break-word whitespace-pre-wrap">{comment.message}</p>
          </div>
        ))}
        <InputGroup>
          <InputGroupTextarea
            ref={textarea}
            aria-label="Comment text"
            placeholder="Add a comment"
            className="block field-sizing-fixed min-h-0 flex-none overflow-hidden leading-6"
            rows={1}
            value={message}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
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
      </SidebarSectionContent>
    </SidebarSection>
  );
}
