import * as React from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { EditorState } from "lexical";
import { COMMAND_PRIORITY_LOW, KEY_ESCAPE_COMMAND } from "lexical";
import { createEditorConfig, normalizeLexicalState } from "./editorConfig";
import { FloatingToolbar } from "./FloatingToolbar";
import { useFrame } from "../../../components/ui/frame";

interface InlineLexicalEditorProps {
  initialState: string;
  externalState: string;
  onChange: (serialized: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

function ExternalStateSync({ externalState }: { externalState: string }) {
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
      const normalized = normalizeLexicalState(externalState);
      const newState = editor.parseEditorState(normalized);
      editor.setEditorState(newState);
    } catch {
      // ignore parse errors
    }
  }, [editor, externalState]);

  return null;
}

function EscapeHandler() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        const root = editor.getRootElement();
        root?.blur();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

function FocusBlurHandler({
  onFocus,
  onBlur,
}: {
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerRootListener((root) => {
      if (!root) return;
      root.addEventListener("focus", onFocus);
      root.addEventListener("blur", onBlur);
      return () => {
        root.removeEventListener("focus", onFocus);
        root.removeEventListener("blur", onBlur);
      };
    });
  }, [editor, onFocus, onBlur]);

  return null;
}

export function InlineLexicalEditor({
  initialState,
  externalState,
  onChange,
  onFocus,
  onBlur,
}: InlineLexicalEditorProps) {
  const { window: iframeWindow } = useFrame();
  const timerRef = React.useRef<number | null>(null);

  const config = React.useMemo(
    () => createEditorConfig(initialState),
    // Only use initialState on mount
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

  const portalContainer = iframeWindow?.document.body ?? document.body;

  return (
    <LexicalComposer initialConfig={config}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            style={{ outline: "none" }}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleChange} />
      <ExternalStateSync externalState={externalState} />
      <EscapeHandler />
      <FocusBlurHandler onFocus={onFocus} onBlur={onBlur} />
      {iframeWindow && (
        <FloatingToolbar
          portalContainer={portalContainer}
          targetWindow={iframeWindow}
        />
      )}
    </LexicalComposer>
  );
}

function LexicalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
