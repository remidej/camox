import * as React from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { EditorState } from "lexical";
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
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
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
