import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Toggle } from "@camox/ui/toggle";
import { $createLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState, RangeSelection } from "lexical";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { Bold, Italic, Underline, Blend } from "lucide-react";
import * as React from "react";

import { lexicalStateToMarkdown } from "@/core/lib/lexicalState";
import { isHttpTextLinkTarget } from "@/core/lib/textLinks";
import { INPUT_BASE_STYLES, INPUT_FOCUS_STYLES, cn } from "@/lib/utils";

import { FORMAT_FLAGS } from "../../lib/modifierFormats";
import { createEditorConfig, normalizeLexicalState } from "./editorConfig";
import { $selectionHasGradient, $toggleGradient } from "./GradientNode";
import { InlineStylesPlugin } from "./InlineStylesPlugin";
import { selectTextLink } from "./selectTextLink";
import { TextLinkPopover } from "./TextLinkPopover";

interface SidebarLexicalEditorProps {
  id?: string;
  value: string | Record<string, unknown>;
  onChange: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
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

function ExternalStateSync({
  value,
  isSyncingRef,
}: {
  value: string | Record<string, unknown>;
  isSyncingRef: React.RefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const root = editor.getRootElement();
    if (root !== null && root === document.activeElement) return;
    try {
      const normalized = normalizeLexicalState(value);
      const newState = editor.parseEditorState(normalized);
      isSyncingRef.current = true;
      editor.setEditorState(newState);
    } catch {
      // ignore parse errors
    }
  }, [editor, value, isSyncingRef]);

  return null;
}

function SidebarFloatingTextToolbar() {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = React.useState(false);
  const [selectedText, setSelectedText] = React.useState("");
  const [linkTarget, setLinkTarget] = React.useState<string | null>(null);
  const [linkClickAnchor, setLinkClickAnchor] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [toolbarState, setToolbarState] = React.useState({
    visible: false,
    top: 0,
    left: 0,
    activeFormats: 0,
  });
  const lastSelectionRef = React.useRef<RangeSelection | null>(null);

  const updateToolbar = React.useCallback(() => {
    if (open) return;
    const root = editor.getRootElement();
    const nativeSelection = window.getSelection();
    if (
      !root ||
      !nativeSelection ||
      nativeSelection.rangeCount === 0 ||
      nativeSelection.isCollapsed
    ) {
      setToolbarState((state) => ({ ...state, visible: open }));
      return;
    }

    if (!root.contains(nativeSelection.anchorNode) || !root.contains(nativeSelection.focusNode)) {
      setToolbarState((state) => ({ ...state, visible: open }));
      return;
    }

    const range = nativeSelection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    let activeFormats = 0;
    let currentLinkTarget: string | null = null;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      lastSelectionRef.current = selection.clone();
      setSelectedText(selection.getTextContent());
      if (selection.hasFormat("bold")) activeFormats |= FORMAT_FLAGS.bold;
      if (selection.hasFormat("italic")) activeFormats |= FORMAT_FLAGS.italic;
      if (selection.hasFormat("underline")) activeFormats |= FORMAT_FLAGS.underline;
      if ($selectionHasGradient()) activeFormats |= FORMAT_FLAGS.gradient;

      let node: any = selection.anchor.getNode();
      while (node) {
        if (node.getType?.() === "link") {
          const url = node.getURL?.();
          currentLinkTarget = typeof url === "string" ? url : null;
          break;
        }
        node = node.getParent?.();
      }
    });
    setLinkTarget(currentLinkTarget);

    setToolbarState({
      visible: true,
      top: rect.top - 52,
      left: rect.left + rect.width / 2,
      activeFormats,
    });
  }, [editor, open]);

  React.useEffect(() => {
    const root = editor.getRootElement();
    const doc = root?.ownerDocument ?? document;
    doc.addEventListener("selectionchange", updateToolbar);
    window.addEventListener("resize", updateToolbar);
    window.addEventListener("scroll", updateToolbar, true);
    return () => {
      doc.removeEventListener("selectionchange", updateToolbar);
      window.removeEventListener("resize", updateToolbar);
      window.removeEventListener("scroll", updateToolbar, true);
    };
  }, [editor, updateToolbar]);

  React.useEffect(() => {
    return editor.registerUpdateListener(() => updateToolbar());
  }, [editor, updateToolbar]);

  React.useEffect(() => {
    return editor.registerRootListener((root) => {
      if (!root) return;

      const handleLinkClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const anchor = target.closest("a");
        if (!anchor || !root.contains(anchor)) return;

        const href = anchor.dataset.camoxLinkTarget ?? anchor.getAttribute("href");
        if (!href) return;

        event.preventDefault();
        event.stopPropagation();

        const rect = anchor.getBoundingClientRect();
        setLinkClickAnchor({
          top: rect.bottom + 8,
          left: rect.left + rect.width / 2,
        });

        const link = selectTextLink(editor, anchor);
        if (!link) return;
        lastSelectionRef.current = link.selection;
        setSelectedText(link.text);
        setLinkTarget(link.target);
        setOpen(true);
      };

      root.addEventListener("click", handleLinkClick);
      return () => root.removeEventListener("click", handleLinkClick);
    });
  }, [editor, updateToolbar]);

  const restoreSelection = () => {
    const selection = $getSelection();
    if ($isRangeSelection(selection) && !selection.isCollapsed()) return;
    if (!lastSelectionRef.current) return;
    $setSelection(lastSelectionRef.current.clone());
  };

  const applyFormat = (formatKey: "bold" | "italic" | "underline" | "gradient") => {
    editor.update(() => {
      restoreSelection();
      if (formatKey === "gradient") {
        $toggleGradient();
        return;
      }
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, formatKey);
    });
  };

  const applyTarget = (target: string | null, text?: string) => {
    editor.update(() => {
      restoreSelection();

      if (target === null) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
        return;
      }

      if (typeof text !== "string") {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, target);
        return;
      }

      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const linkNode = $createLinkNode(target);
      linkNode.append($createTextNode(text));
      selection.insertNodes([linkNode]);
    });
    setOpen(false);
    setLinkClickAnchor(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setLinkClickAnchor(null);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, select, textarea")) return;
    event.preventDefault();
  };

  if (linkClickAnchor) {
    return (
      <TextLinkPopover
        open={open}
        onOpenChange={handleOpenChange}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed size-1 min-w-0 p-0 opacity-0"
            style={{ top: linkClickAnchor.top, left: linkClickAnchor.left }}
          />
        }
        text={selectedText}
        target={linkTarget}
        onSave={applyTarget}
        onUnlink={() => applyTarget(null)}
      />
    );
  }

  if (!toolbarState.visible) return null;

  return (
    <FloatingToolbar
      onMouseDown={handleMouseDown}
      className="fixed z-50 gap-0.5 rounded-lg p-1 shadow-lg"
      style={{ top: toolbarState.top, left: toolbarState.left }}
    >
      <Toggle
        data-state={toolbarState.activeFormats & FORMAT_FLAGS.bold ? "on" : "off"}
        pressed={!!(toolbarState.activeFormats & FORMAT_FLAGS.bold)}
        variant="default"
        size="sm"
        className="h-7 min-w-7 px-1.5"
        aria-label="Bold"
        onPressedChange={() => applyFormat("bold")}
      >
        <Bold />
      </Toggle>
      <Toggle
        data-state={toolbarState.activeFormats & FORMAT_FLAGS.italic ? "on" : "off"}
        pressed={!!(toolbarState.activeFormats & FORMAT_FLAGS.italic)}
        variant="default"
        size="sm"
        className="h-7 min-w-7 px-1.5"
        aria-label="Italic"
        onPressedChange={() => applyFormat("italic")}
      >
        <Italic />
      </Toggle>
      {(
        [
          { key: "underline", label: "Underline", icon: Underline },
          { key: "gradient", label: "Gradient", icon: Blend },
        ] as const
      ).map(({ key, label, icon: Icon }) => (
        <Toggle
          key={key}
          pressed={!!(toolbarState.activeFormats & FORMAT_FLAGS[key])}
          variant="default"
          size="sm"
          className="h-7 min-w-7 px-1.5"
          aria-label={label}
          onPressedChange={() => applyFormat(key)}
        >
          <Icon />
        </Toggle>
      ))}
      <TextLinkPopover
        open={open}
        onOpenChange={handleOpenChange}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-foreground hover:text-foreground h-7 min-w-7 px-1.5"
          />
        }
        text={selectedText}
        target={linkTarget}
        onSave={applyTarget}
        onUnlink={() => applyTarget(null)}
      />
    </FloatingToolbar>
  );
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
        if (!isHttpTextLinkTarget(url)) return false;

        event.preventDefault();
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

export function SidebarLexicalEditor({
  id,
  value,
  onChange,
  onFocus,
  onBlur,
}: SidebarLexicalEditorProps) {
  const timerRef = React.useRef<number | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const isSyncingRef = React.useRef(false);
  const pendingMarkdownRef = React.useRef<string | null>(null);
  const flushChange = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const markdown = pendingMarkdownRef.current;
    pendingMarkdownRef.current = null;
    if (markdown !== null) onChangeRef.current(markdown);
  }, []);

  const config = React.useMemo(() => createEditorConfig(value), []);

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      // Ignore editor updates triggered by ExternalStateSync to avoid loops
      if (isSyncingRef.current) {
        isSyncingRef.current = false;
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingMarkdownRef.current = lexicalStateToMarkdown(
        editorState.toJSON() as unknown as Record<string, unknown>,
      );
      timerRef.current = window.setTimeout(flushChange, 300);
    },
    [flushChange],
  );

  React.useEffect(() => flushChange, [flushChange]);

  return (
    // Keep floating controls from changing the parent's space-y sibling spacing.
    <div className="w-full min-w-0">
      <LexicalComposer initialConfig={config}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              id={id}
              className={cn(
                INPUT_BASE_STYLES,
                INPUT_FOCUS_STYLES,
                "flex min-h-[80px] w-full px-3 py-2",
              )}
              onFocus={onFocus}
              onBlur={() => {
                flushChange();
                onBlur?.();
              }}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        <HistoryPlugin />
        <LinkPlugin />
        <ExternalStateSync value={value} isSyncingRef={isSyncingRef} />
        <EnterAsLineBreakHandler />
        <PasteUrlAsLinkHandler />
        <SidebarFloatingTextToolbar />
        <InlineStylesPlugin />
      </LexicalComposer>
    </div>
  );
}

function LexicalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
