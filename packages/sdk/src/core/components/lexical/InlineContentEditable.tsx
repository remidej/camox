import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import * as React from "react";

/**
 * A ContentEditable that renders a <span> instead of <div>,
 * so it can be nested inside phrasing elements like <h1>, <p>, etc.
 */
export const InlineContentEditable = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(function InlineContentEditable(props, ref) {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setEditable] = React.useState(false);

  const handleRef = React.useCallback(
    (el: HTMLSpanElement | null) => {
      if (el?.ownerDocument?.defaultView) {
        editor.setRootElement(el);
      } else {
        editor.setRootElement(null);
      }
    },
    [editor],
  );

  const mergedRef = React.useMemo(() => {
    return (el: HTMLSpanElement | null) => {
      handleRef(el);
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };
  }, [handleRef, ref]);

  React.useLayoutEffect(() => {
    editor.setEditable(false);
    return editor.registerEditableListener(setEditable);
  }, [editor]);

  const handleBlur = React.useCallback(() => {
    editor.setEditable(false);
  }, [editor]);

  return (
    <span
      {...props}
      contentEditable={isEditable}
      ref={mergedRef}
      role="textbox"
      spellCheck
      onBlur={handleBlur}
    />
  );
});
