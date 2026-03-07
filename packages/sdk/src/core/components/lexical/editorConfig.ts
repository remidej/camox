import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { ParagraphNode } from "lexical";
import { isLexicalState, plainTextToLexicalState } from "../../lib/lexicalState";
import { InlineParagraphNode } from "./InlineParagraphNode";

export function normalizeLexicalState(value: string): string {
  if (isLexicalState(value)) return value;
  return plainTextToLexicalState(value);
}

export function createEditorConfig(
  initialState: string | undefined,
): InitialConfigType {
  return {
    namespace: "camox",
    editorState: initialState ? normalizeLexicalState(initialState) : undefined,
    onError: (error) => {
      console.error("Lexical error:", error);
    },
    nodes: [
      InlineParagraphNode,
      {
        replace: ParagraphNode,
        with: () => new InlineParagraphNode(),
        withKlass: InlineParagraphNode,
      },
    ],
  };
}
