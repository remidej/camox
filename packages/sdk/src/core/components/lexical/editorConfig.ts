import { LinkNode } from "@lexical/link";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { ParagraphNode } from "lexical";

import { isLexicalState, markdownToLexicalState } from "../../lib/lexicalState";
import { GradientNode } from "./GradientNode";
import { InlineParagraphNode } from "./InlineParagraphNode";

export function normalizeLexicalState(value: string | Record<string, unknown>): string {
  let state: any = markdownToLexicalState("");
  if (isLexicalState(value)) state = typeof value === "string" ? JSON.parse(value) : value;
  else if (typeof value === "string") state = markdownToLexicalState(value);

  // Fields are inline content. Preserve paragraph separators as explicit breaks
  // rather than adjacent paragraph spans that collapse together in edit mode.
  const paragraphs = state.root.children;
  if (paragraphs.length <= 1) return JSON.stringify(state);
  const children = paragraphs.flatMap((paragraph: any, index: number) => [
    ...(index
      ? [
          { type: "linebreak", version: 1 },
          { type: "linebreak", version: 1 },
        ]
      : []),
    ...(paragraph.children ?? []),
  ]);
  return JSON.stringify({
    ...state,
    root: { ...state.root, children: [{ ...paragraphs[0], children }] },
  });
}

export function createEditorConfig(
  initialState: string | Record<string, unknown> | undefined,
): InitialConfigType {
  return {
    namespace: "camox",
    editorState: initialState ? normalizeLexicalState(initialState) : undefined,
    onError: (error) => {
      console.error("Lexical error:", error);
    },
    theme: {},
    nodes: [
      LinkNode,
      GradientNode,
      InlineParagraphNode,
      {
        replace: ParagraphNode,
        with: () => new InlineParagraphNode(),
        withKlass: InlineParagraphNode,
      },
    ],
  };
}
