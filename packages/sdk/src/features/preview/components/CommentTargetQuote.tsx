import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { isLexicalState, lexicalStateToPlainText } from "@/core/lib/lexicalState";
import { blockQueries, pageQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { getCommentTargetFieldType, type CommentTarget } from "../previewCommentsStore";

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="text-muted-foreground my-2 border-l-2 border-yellow-600 pl-2 text-sm wrap-break-word whitespace-pre-wrap">
      {children}
    </blockquote>
  );
}

function PageQuote({ pageId }: { pageId: number }) {
  const { data: page, isPending } = useQuery(pageQueries.getById(pageId));
  return <Quote>{page?.nickname || (isPending ? "Loading…" : "Page unavailable")}</Quote>;
}

function BlockQuote({ target }: { target: Exclude<CommentTarget, { kind: "page" }> }) {
  const app = useCamoxApp();
  const { data: bundle, isPending } = useQuery(blockQueries.get(target.blockId));
  if (!bundle) return <Quote>{isPending ? "Loading…" : "Content unavailable"}</Quote>;

  const subject =
    "itemId" in target
      ? bundle.repeatableItems.find((item) => item.id === target.itemId)
      : bundle.block;
  if (!subject) return <Quote>Content unavailable</Quote>;

  if ("fieldName" in target) {
    const fieldType = getCommentTargetFieldType(target, bundle, app);
    const value = (subject.content as Record<string, unknown>)[target.fieldName];
    if (fieldType === "String") {
      if (typeof value === "string" || isLexicalState(value)) {
        return (
          <Quote>
            {lexicalStateToPlainText(value as string | Record<string, unknown>) || "Empty text"}
          </Quote>
        );
      }
      if (value == null) return <Quote>Empty text</Quote>;
    }
    if (
      fieldType === "Link" &&
      value &&
      typeof value === "object" &&
      "text" in value &&
      typeof value.text === "string"
    ) {
      return <Quote>{value.text || "Empty link text"}</Quote>;
    }
  }

  return (
    <Quote>{subject.summary || ("itemId" in target ? "Untitled item" : "Untitled block")}</Quote>
  );
}

export function CommentTargetQuote({ pageId, target }: { pageId: number; target: CommentTarget }) {
  if (target.kind === "page") return <PageQuote pageId={pageId} />;
  return <BlockQuote target={target} />;
}
