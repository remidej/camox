import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { isLexicalState, lexicalStateToPlainText } from "@/core/lib/lexicalState";
import { blockQueries, pageQueries } from "@/lib/queries";

import type { CommentTarget } from "../previewCommentsStore";

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

function BlockQuote({ target }: { target: CommentTarget & { blockId: number } }) {
  const { data: bundle, isPending } = useQuery(blockQueries.get(target.blockId));
  if (!bundle) return <Quote>{isPending ? "Loading…" : "Content unavailable"}</Quote>;

  const subject =
    target.itemId == null
      ? bundle.block
      : bundle.repeatableItems.find((item) => item.id === target.itemId);
  if (!subject) return <Quote>Content unavailable</Quote>;

  if (target.fieldName != null) {
    const value = (subject.content as Record<string, unknown>)[target.fieldName];
    if (target.fieldType === "String" || target.fieldType == null) {
      if (typeof value === "string" || isLexicalState(value)) {
        return (
          <Quote>
            {lexicalStateToPlainText(value as string | Record<string, unknown>) || "Empty text"}
          </Quote>
        );
      }
      if (value == null && target.fieldType === "String") return <Quote>Empty text</Quote>;
    }
    if (
      target.fieldType === "Link" &&
      value &&
      typeof value === "object" &&
      "text" in value &&
      typeof value.text === "string"
    ) {
      return <Quote>{value.text || "Empty link text"}</Quote>;
    }
  }

  return (
    <Quote>{subject.summary || (target.itemId == null ? "Untitled block" : "Untitled item")}</Quote>
  );
}

export function CommentTargetQuote({ pageId, target }: { pageId: number; target: CommentTarget }) {
  if (target.blockId == null) return <PageQuote pageId={pageId} />;
  return <BlockQuote target={{ ...target, blockId: target.blockId }} />;
}
