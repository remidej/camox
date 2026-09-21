import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Text: window.Text,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const { createRoot } = await import("react-dom/client");
const { LexicalComposer } = await import("@lexical/react/LexicalComposer");
const { useLexicalComposerContext } = await import("@lexical/react/LexicalComposerContext");
const { ContentEditable } = await import("@lexical/react/LexicalContentEditable");
const { RichTextPlugin } = await import("@lexical/react/LexicalRichTextPlugin");
const { $getRoot, $isTextNode, createEditor } = await import("lexical");
const { createEditorConfig } = await import("./editorConfig");
const { InlineStylesPlugin } = await import("./InlineStylesPlugin");
const { selectTextLink } = await import("./selectTextLink");
const { HighlightNode, $normalizeHighlight, $toggleHighlight, $selectionHasHighlight } =
  await import("./HighlightNode");
const { lexicalStateToMarkdown, markdownToLexicalState } = await import("../../lib/lexicalState");
const { markdownToReactNodes } = await import("../../lib/lexicalReact");
type LexicalEditor = import("lexical").LexicalEditor;

void test("editor and public output share text, highlight, and link appearance", async () => {
  const value = "<highlight>stay <u>***nimble***</u> [here](https://example.com)</highlight>";
  const styles = {
    textStyle: ({ bold, highlight }: { bold: boolean; highlight: boolean }) => {
      if (highlight)
        return {
          className: "custom-highlight",
          style: {
            backgroundImage: "linear-gradient(red, blue)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          },
        };
      return {
        className: bold ? "red" : undefined,
        style: bold ? { color: "red", letterSpacing: 2 } : undefined,
      };
    },
    linkStyle: () => ({ className: "custom-link", style: { color: "green" } }),
  };
  let editor!: LexicalEditor;
  function Capture() {
    [editor] = useLexicalComposerContext();
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LexicalComposer initialConfig={createEditorConfig(value)}>
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          ErrorBoundary={({ children }) => <>{children}</>}
        />
        <Capture />
        <InlineStylesPlugin {...styles} />
      </LexicalComposer>,
    );
  });
  const publicHost = document.createElement("div");
  publicHost.innerHTML = renderToStaticMarkup(markdownToReactNodes(value, styles));
  for (const selector of ["strong", "a", "[data-camox-highlight]"]) {
    const editable = host.querySelector<HTMLElement>(selector)!;
    const published = publicHost.querySelector<HTMLElement>(selector)!;
    assert.ok(editable, selector);
    assert.equal(editable.style.cssText, published.style.cssText, selector);
    assert.equal(editable.className, published.className, selector);
  }
  assert.equal(host.querySelectorAll("[data-camox-highlight]").length, 1);
  assert.equal(host.querySelectorAll(".custom-highlight").length, 1);
  assert.equal(
    host.querySelector<HTMLElement>("[data-camox-highlight]")!.style.backgroundImage,
    "linear-gradient(red, blue)",
  );
  assert.equal(host.querySelector<HTMLElement>("strong")!.style.backgroundImage, "");
  assert.equal(
    lexicalStateToMarkdown(editor.getEditorState().toJSON() as unknown as Record<string, unknown>),
    value,
  );
  await act(async () => {
    editor.update(() => {
      const text = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "nimble")!;
      text.select(0, text.getTextContentSize()).formatText("bold");
    });
  });
  const italic = host.querySelector<HTMLElement>("em")!;
  assert.ok(italic);
  assert.equal(italic.style.color, "");
  assert.equal(italic.className, "");
  assert.equal(italic.style.textDecorationLine, "underline");
  assert.equal(host.querySelectorAll("[data-camox-highlight]").length, 1);
  await act(async () => root.unmount());
  host.remove();
});

void test("clicking links captures their destination and selection before popover focus", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let editor!: LexicalEditor;
  function Capture() {
    [editor] = useLexicalComposerContext();
    return null;
  }
  await act(async () => {
    root.render(
      <LexicalComposer
        initialConfig={createEditorConfig(
          "before [**external**](https://example.com) and [page](camox:page:42) after",
        )}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          ErrorBoundary={({ children }) => <>{children}</>}
        />
        <Capture />
      </LexicalComposer>,
    );
  });
  const anchors = host.querySelectorAll("a");
  for (const [index, target, text] of [
    [0, "https://example.com", "external"],
    [1, "camox:page:42", "page"],
  ] as const) {
    await act(async () => {
      // Simulate a stale editor selection outside the clicked link.
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
      const link = selectTextLink(editor, anchors[index]);
      assert.ok(link);
      assert.equal(link.target, target);
      assert.equal(link.text, text);
      editor.getEditorState().read(() => {
        assert.equal(link.selection.getTextContent(), text);
        assert.equal(link.selection.isCollapsed(), false);
      });
    });
  }
  await act(async () => root.unmount());
  host.remove();
});

function setup(value: string) {
  const config = createEditorConfig(value);
  const editor = createEditor({
    nodes: config.nodes,
    namespace: config.namespace,
    onError: (error) => {
      throw error;
    },
  });
  editor.registerNodeTransform(HighlightNode, $normalizeHighlight);
  editor.setEditorState(editor.parseEditorState(JSON.stringify(markdownToLexicalState(value))));
  return editor;
}
function save(editor: LexicalEditor) {
  return lexicalStateToMarkdown(
    editor.getEditorState().toJSON() as unknown as Record<string, unknown>,
  );
}

void test("partial removal preserves unselected highlight and reapplying merges boundaries", () => {
  const editor = setup("<highlight>stay very nimble</highlight>");
  editor.update(
    () => {
      const text = $getRoot().getAllTextNodes()[0];
      text.select(5, 9);
      assert.equal($selectionHasHighlight(), true);
      $toggleHighlight();
    },
    { discrete: true },
  );
  assert.equal(save(editor), "<highlight>stay </highlight>very<highlight> nimble</highlight>");
  editor.update(
    () => {
      const text = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "very")!;
      text.select(0, 4);
      $toggleHighlight();
    },
    { discrete: true },
  );
  assert.equal(save(editor), "<highlight>stay very nimble</highlight>");
});

void test("backwards selections and line breaks round trip highlight", () => {
  const editor = setup("stay very nimble");
  editor.update(
    () => {
      $getRoot().getAllTextNodes()[0].select(9, 5);
      $toggleHighlight();
    },
    { discrete: true },
  );
  assert.equal(save(editor), "stay <highlight>very</highlight> nimble");
  const multiline = setup("<highlight>first\n\n***second***</highlight>");
  assert.equal(save(multiline), "<highlight>first\n\n***second***</highlight>");
});

void test("bold inside highlight does not split its boundary", () => {
  const editor = setup("<highlight>stay very nimble</highlight>");
  editor.update(
    () => {
      const text = $getRoot().getAllTextNodes()[0];
      const selection = text.select(5, 9);
      selection.formatText("bold");
      selection.formatText("italic");
    },
    { discrete: true },
  );
  assert.equal(save(editor), "<highlight>stay ***very*** nimble</highlight>");
});

void test("highlight spans fully selected links and keeps partial link selections linked", () => {
  const editor = setup("stay [very](https://example.com) nimble");
  editor.update(
    () => {
      $getRoot().select(0, $getRoot().getChildrenSize());
      $toggleHighlight();
    },
    { discrete: true },
  );
  assert.equal(save(editor), "<highlight>stay [very](https://example.com) nimble</highlight>");
  editor.update(
    () => {
      const text = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "very")!;
      assert.ok($isTextNode(text));
      text.select(1, 3);
      $toggleHighlight();
    },
    { discrete: true },
  );
  assert.match(save(editor), /\[er\]\(https:\/\/example.com\)/);
});
