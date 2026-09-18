import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState } from "lexical";
import {
  COMMAND_PRIORITY_LOW,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import * as React from "react";

import { useFrame } from "../../../features/preview/components/Frame";
import type { MarkdownToReactNodesOptions } from "../../lib/lexicalReact";
import { lexicalStateToMarkdown } from "../../lib/lexicalState";
import { isValidTextLinkTarget } from "../../lib/textLinks";
import { createEditorConfig, normalizeLexicalState } from "./editorConfig";
import { InlineContentEditable } from "./InlineContentEditable";
import { InlineStylesPlugin } from "./InlineStylesPlugin";
import { SelectionBroadcaster } from "./SelectionBroadcaster";

interface InlineLexicalEditorProps extends MarkdownToReactNodesOptions {
  initialState: string | Record<string, unknown>;
  externalState: string | Record<string, unknown>;
  onChange: (markdown: string) => void;
  onFocus: () => void;
  /** `wasEdited` is true if the editor's content changed during the focus session that's now ending. */
  onBlur: (wasEdited: boolean) => void;
}

function ExternalStateSync({ externalState }: { externalState: string | Record<string, unknown> }) {
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

function EnterAsLineBreakHandler() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        event?.preventDefault();
        editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

function PasteUrlAsLinkHandler() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;

        if (!("clipboardData" in event) || !event.clipboardData) return false;

        const url = event.clipboardData.getData("text/plain").trim();
        if (!url || !isValidTextLinkTarget(url)) return false;

        event.preventDefault();
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

function FocusBlurHandler({ onFocus, onBlur }: { onFocus: () => void; onBlur: () => void }) {
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
  textStyle,
  linkStyle,
  pages,
  fallbackHref,
}: InlineLexicalEditorProps) {
  const { window: iframeWindow } = useFrame();
  const timerRef = React.useRef<number | null>(null);
  const pendingMarkdownRef = React.useRef<string | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const flushChange = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const markdown = pendingMarkdownRef.current;
    pendingMarkdownRef.current = null;
    if (markdown !== null) onChangeRef.current(markdown);
  }, []);
  const isFocusedRef = React.useRef(false);
  const editedDuringFocusRef = React.useRef(false);

  const config = React.useMemo(
    () => createEditorConfig(initialState),
    // Only use initialState on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      if (!isFocusedRef.current) return;
      editedDuringFocusRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingMarkdownRef.current = lexicalStateToMarkdown(
        editorState.toJSON() as unknown as Record<string, unknown>,
      );
      timerRef.current = window.setTimeout(flushChange, 300);
    },
    [flushChange],
  );

  const handleFocus = React.useCallback(() => {
    isFocusedRef.current = true;
    editedDuringFocusRef.current = false;
    onFocus();
  }, [onFocus]);

  const handleBlur = React.useCallback(() => {
    flushChange();
    isFocusedRef.current = false;
    const wasEdited = editedDuringFocusRef.current;
    editedDuringFocusRef.current = false;
    onBlur(wasEdited);
  }, [onBlur, flushChange]);

  React.useEffect(() => flushChange, [flushChange]);

  return (
    <LexicalComposer initialConfig={config}>
      <RichTextPlugin
        contentEditable={<InlineContentEditable style={{ outline: "none" }} />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <HistoryPlugin />
      <LinkPlugin />
      <ExternalStateSync externalState={externalState} />
      <EscapeHandler />
      <EnterAsLineBreakHandler />
      <PasteUrlAsLinkHandler />
      <FocusBlurHandler onFocus={handleFocus} onBlur={handleBlur} />
      <InlineStylesPlugin
        textStyle={textStyle}
        linkStyle={linkStyle}
        pages={pages}
        fallbackHref={fallbackHref}
      />
      {iframeWindow && <SelectionBroadcaster targetWindow={iframeWindow} />}
    </LexicalComposer>
  );
}

function LexicalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
