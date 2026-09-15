import { $isLinkNode } from "@lexical/link";
import { $getNearestNodeFromDOMNode, type LexicalEditor, type RangeSelection } from "lexical";

interface TextLinkSelection {
  target: string;
  text: string;
  selection: RangeSelection;
}

// Capture the editor selection synchronously, before the popover takes focus.
// A native DOM selection alone may not have reached Lexical yet.
export function selectTextLink(
  editor: LexicalEditor,
  anchor: HTMLAnchorElement,
): TextLinkSelection | null {
  let result: TextLinkSelection | null = null;
  editor.update(
    () => {
      const node = $getNearestNodeFromDOMNode(anchor);
      if (!$isLinkNode(node)) return;
      const selection = node.select(0, node.getChildrenSize());
      result = {
        target: node.getURL(),
        text: node.getTextContent(),
        selection: selection.clone(),
      };
    },
    { discrete: true },
  );
  return result;
}
