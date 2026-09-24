import { COMMENT_MESSAGE_MAX_LENGTH } from "@camox/api-contract";
import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@camox/ui/input-group";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { ArrowUp, Check, Eye, X } from "lucide-react";
import * as React from "react";

import type { FieldType } from "@/core/lib/fieldTypes";
import { blockQueries, commentMutations, commentQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { areCommentsEnabled } from "../commentsEnabled";
import {
  type CommentTarget,
  getCommentTargetFieldType,
  previewCommentsStore,
  revealCommentTarget,
} from "../previewCommentsStore";
import { previewStore } from "../previewStore";
import { usePageComments } from "../usePageComments";
import { CommentHeader } from "./CommentHeader";
import { CommentTargetQuote } from "./CommentTargetQuote";
import { SendFeedbackDialog } from "./SendFeedbackDialog";
import { SidebarSection, SidebarSectionHeader, SidebarSectionContent } from "./SidebarSection";

function resizeComposer(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

type AttachedCommentsProps = {
  pageId?: number;
  blockId?: number;
  itemId?: number;
  fieldName?: string;
  fieldType?: FieldType;
  allPageComments?: boolean;
};

function editorTarget({ blockId, itemId, fieldName }: AttachedCommentsProps): CommentTarget {
  if (blockId == null) return { kind: "page" };
  if (itemId != null) {
    if (fieldName != null) return { kind: "item-field", blockId, itemId, fieldName };
    return { kind: "item", blockId, itemId };
  }
  if (fieldName != null) return { kind: "block-field", blockId, fieldName };
  return { kind: "block", blockId };
}

/** Gate before mounting queries, mutations, or composers. */
export function AttachedComments(props: AttachedCommentsProps) {
  if (!areCommentsEnabled() || props.pageId == null) return null;
  return <EnabledAttachedComments {...props} pageId={props.pageId} />;
}

/** Shared comment list and composer for editors and the Feedback sidebar. */
function EnabledAttachedComments({
  pageId,
  blockId,
  itemId,
  fieldName,
  allPageComments = false,
}: AttachedCommentsProps & { pageId: number }) {
  const camoxApp = useCamoxApp();
  const queryClient = useQueryClient();
  const commentsQuery = usePageComments(pageId);
  const { draft, activeId, focusTarget } = useSelector(
    previewCommentsStore,
    (state) => state.context,
  );
  const target = editorTarget({ blockId, itemId, fieldName });
  const matches = (entry: { pageId: number; target: CommentTarget | null }) =>
    entry.pageId === pageId &&
    (allPageComments ||
      (entry.target != null &&
        entry.target.kind === target.kind &&
        (!("blockId" in entry.target) || entry.target.blockId === blockId) &&
        (!("itemId" in entry.target) || entry.target.itemId === itemId) &&
        (!("fieldName" in entry.target) || entry.target.fieldName === fieldName)));
  const attached = (commentsQuery.data ?? []).filter(matches);
  const visible = attached.filter((comment) => !comment.resolved);
  const currentDraft = draft && matches(draft) ? draft : null;
  const selected = attached.find((comment) => comment.id === activeId);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const activeComment = React.useRef<HTMLDivElement>(null);
  const draftTarget = currentDraft?.target;
  const message = currentDraft?.message ?? "";
  const submitting = React.useRef(false);
  const setResolved = useMutation({
    ...commentMutations.setResolved(),
    onSuccess: (comment, submitted) => {
      const queryKey = commentQueries.list(submitted.pageId).queryKey;
      queryClient.setQueryData<typeof commentsQuery.data>(queryKey, (comments) =>
        comments?.map((entry) => (entry.id === comment.id ? comment : entry)),
      );
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("Could not update feedback. Please try again."),
  });
  const createComment = useMutation({
    ...commentMutations.create(),
    onSuccess: (comment, submitted) => {
      const queryKey = commentQueries.list(submitted.pageId).queryKey;
      queryClient.setQueryData<typeof commentsQuery.data>(queryKey, (comments) => {
        if (!comments) return undefined;
        return [...comments.filter((entry) => entry.id !== comment.id), comment].sort(
          (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        );
      });
      void queryClient.invalidateQueries({ queryKey });
      previewCommentsStore.send({ type: "postSucceeded", draft: submitted });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const selectComment = async (id: string, target: CommentTarget) => {
    previewCommentsStore.send({ type: "selectComment", id });
    if (target.kind === "page") {
      revealCommentTarget(target);
      return;
    }
    try {
      const bundle = await queryClient.fetchQuery(blockQueries.get(target.blockId));
      if (previewCommentsStore.getSnapshot().context.activeId !== id) return;
      if ("itemId" in target && !bundle.repeatableItems.some((item) => item.id === target.itemId)) {
        toast.error("This feedback target is no longer available.");
        return;
      }
      const fieldType = getCommentTargetFieldType(target, bundle, camoxApp);
      if ("fieldName" in target && !fieldType) {
        toast.error("This feedback field is no longer available.");
        return;
      }
      revealCommentTarget(target, fieldType);
    } catch {
      toast.error("This feedback target is no longer available.");
    }
  };

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
    if (!areCommentsEnabled() || !currentDraft || !message.trim() || submitting.current) return;
    submitting.current = true;
    createComment.mutate(currentDraft);
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
        {commentsQuery.isPending && (
          <p className="text-muted-foreground text-sm">Loading feedback…</p>
        )}
        {commentsQuery.isError && (
          <div role="alert" className="text-sm">
            Could not load feedback.{" "}
            <Button type="button" variant="link" onClick={() => void commentsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {allPageComments && commentsQuery.isSuccess && visible.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {attached.length === 0 ? "No feedback yet." : "No unresolved feedback."} Select
            something on the page to comment on it.
          </p>
        )}
        {visible.map((comment) => (
          <div
            key={comment.id}
            ref={comment.id === activeId ? activeComment : undefined}
            className="rounded-md p-1"
          >
            <div>
              <CommentHeader author={comment.author} createdAt={comment.createdAt} />
              <div className="pl-8">
                {allPageComments &&
                  (comment.target ? (
                    <CommentTargetQuote pageId={pageId} target={comment.target} />
                  ) : (
                    <p className="text-muted-foreground text-sm">Target no longer available</p>
                  ))}
                <p className="text-sm wrap-break-word whitespace-pre-wrap">{comment.message}</p>
              </div>
            </div>
            <ButtonGroup className="mt-2 ml-8" aria-label="Comment actions">
              {allPageComments && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={comment.target == null}
                  onClick={() => {
                    if (comment.target) void selectComment(comment.id, comment.target);
                  }}
                >
                  <Eye className="text-muted-foreground" />
                  View
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Mark as done"
                disabled={setResolved.isPending}
                onClick={() => {
                  setResolved.mutate({
                    pageId,
                    id: comment.id,
                    resolved: true,
                  });
                }}
              >
                <Check className="text-muted-foreground" />
                Done
              </Button>
            </ButtonGroup>
          </div>
        ))}
        {allPageComments && (
          <SendFeedbackDialog key={pageId} pageId={pageId} disabled={visible.length === 0} />
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
              maxLength={COMMENT_MESSAGE_MAX_LENGTH}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                event.stopPropagation();
                submit();
              }}
              onChange={(event) => {
                if (!currentDraft) {
                  previewCommentsStore.send({
                    type: "startComment",
                    pageId,
                    target,
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
                disabled={!message.trim() || createComment.isPending}
                onClick={submit}
              >
                <ArrowUp size={16} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
        {createComment.isError && currentDraft?.id === createComment.variables?.id && (
          <p role="alert" className="text-destructive text-sm">
            Could not post feedback. Your draft is saved here; try posting again.
          </p>
        )}
      </SidebarSectionContent>
    </SidebarSection>
  );
}
