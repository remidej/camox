import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState } from "lexical";
import * as React from "react";

import { INPUT_BASE_STYLES, INPUT_FOCUS_STYLES, cn } from "@/lib/utils";

import { createEditorConfig, normalizeLexicalState } from "./editorConfig";

interface SidebarLexicalEditorProps {
  value: string;
  onChange: (serialized: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

function ExternalStateSync({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const isFocusedRef = React.useRef(false);

  React.useEffect(() => {
    return editor.registerRootListener((root) => {
      if (!root) return;
      const handleFocus = () => {
        isFocusedRef.current = true;
      };
      const handleBlur = () => {
        isFocusedRef.current = false;
      };
      root.addEventListener("focus", handleFocus);
      root.addEventListener("blur", handleBlur);
      return () => {
        root.removeEventListener("focus", handleFocus);
        root.removeEventListener("blur", handleBlur);
      };
    });
  }, [editor]);

  React.useEffect(() => {
    if (isFocusedRef.current) return;
    try {
      const normalized = normalizeLexicalState(value);
      const newState = editor.parseEditorState(normalized);
      editor.setEditorState(newState);
    } catch {
      // ignore parse errors
    }
  }, [editor, value]);

  return null;
}

export function SidebarLexicalEditor({
  value,
  onChange,
  onFocus,
  onBlur,
}: SidebarLexicalEditorProps) {
  const timerRef = React.useRef<number | null>(null);

  const config = React.useMemo(
    () => createEditorConfig(value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const serialized = JSON.stringify(editorState.toJSON());
        onChange(serialized);
      }, 300);
    },
    [onChange],
  );

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <LexicalComposer initialConfig={config}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className={cn(
              INPUT_BASE_STYLES,
              INPUT_FOCUS_STYLES,
              "flex min-h-[80px] w-full px-3 py-2",
            )}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleChange} />
      <ExternalStateSync value={value} />
    </LexicalComposer>
  );
}

function LexicalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
