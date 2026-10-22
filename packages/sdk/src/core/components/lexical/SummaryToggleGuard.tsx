import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import * as React from "react";

/**
 * Keeps typing in a field placed inside a `<summary>` (an accordion question) from toggling its
 * `<details>`. Chromium activates the summary with a synthetic click after a space keyup even
 * when the key went to an editable descendant, and stopping the key events doesn't prevent it,
 * so the click is canceled instead. A keyboard click has `detail` 0; pointer clicks still toggle.
 */
export function SummaryToggleGuard() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerRootListener((root) => {
      const summary = root?.closest("summary");
      if (!root || !summary) return;
      const handleClick = (event: MouseEvent) => {
        if (event.target !== summary || event.detail !== 0) return;
        if (root.contains(root.ownerDocument.activeElement)) event.preventDefault();
      };
      summary.addEventListener("click", handleClick);
      return () => summary.removeEventListener("click", handleClick);
    });
  }, [editor]);

  return null;
}
