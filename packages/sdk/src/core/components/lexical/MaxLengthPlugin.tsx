import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $restoreEditorState } from "@lexical/utils";
import type { LexicalNode, SerializedElementNode, SerializedLexicalNode } from "lexical";
import { $getRoot, $isElementNode, RootNode } from "lexical";
import * as React from "react";

import { lexicalStateToMarkdown } from "../../lib/lexicalState";

function $serialize(node: LexicalNode): SerializedLexicalNode {
  const json = node.exportJSON();
  if (!$isElementNode(node)) return json;
  return { ...json, children: node.getChildren().map($serialize) } as SerializedElementNode;
}

/** The length of the stored markdown, in code points, as the API's validation counts it. */
function $storedLength(): number {
  let length = 0;
  for (const _codePoint of lexicalStateToMarkdown({ root: $serialize($getRoot()) })) length++;
  return length;
}

/**
 * Rejects edits that would make a string field's stored markdown longer than its `maxLength`,
 * so the editor never holds a value the API refuses to save. A value that is already too long
 * can still be shortened.
 */
export function MaxLengthPlugin({ maxLength }: { maxLength?: number }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (maxLength === undefined) return;
    return editor.registerNodeTransform(RootNode, () => {
      const length = $storedLength();
      if (length <= maxLength) return;
      const previous = editor.getEditorState();
      if (length <= previous.read($storedLength)) return;
      $restoreEditorState(editor, previous);
    });
  }, [editor, maxLength]);

  return null;
}
