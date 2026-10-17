import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import { act } from "react";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Text: window.Text,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const { createRoot } = await import("react-dom/client");
const { $getRoot } = await import("lexical");
const { InlineLexicalEditor } = await import("./InlineLexicalEditor");
const { SidebarLexicalEditor } = await import("./SidebarLexicalEditor");
type LexicalEditor = import("lexical").LexicalEditor;

/** Renders an editor and returns its Lexical root element, editor, and saved values. */
async function render(element: (onChange: (markdown: string) => void) => React.ReactElement) {
  const saved: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element((markdown) => saved.push(markdown))));
  const editable = host.querySelector<HTMLElement>("[data-lexical-editor]")!;
  const editor = (editable as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  return {
    saved,
    editable,
    /** Types text at the end of the field, then leaves it so pending changes save. */
    async type(text: string) {
      await act(async () => {
        editable.dispatchEvent(new window.FocusEvent("focus") as unknown as Event);
        editor.update(() => $getRoot().selectEnd().insertText(text), { discrete: true });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        editable.dispatchEvent(new window.FocusEvent("blur") as unknown as Event);
      });
    },
    /** Deletes the field's last character, then leaves it so pending changes save. */
    async backspace() {
      await act(async () => {
        editable.dispatchEvent(new window.FocusEvent("focus") as unknown as Event);
        editor.update(
          () => {
            const text = $getRoot().getAllTextNodes().at(-1)!;
            text.setTextContent(text.getTextContent().slice(0, -1));
          },
          { discrete: true },
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        editable.dispatchEvent(new window.FocusEvent("blur") as unknown as Event);
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const inline = (value: string, maxLength: number) => (onChange: (markdown: string) => void) => (
  <InlineLexicalEditor
    initialState={value}
    externalState={value}
    maxLength={maxLength}
    onChange={onChange}
    onFocus={() => undefined}
    onBlur={() => undefined}
  />
);

const sidebar = (value: string, maxLength: number) => (onChange: (markdown: string) => void) => (
  <SidebarLexicalEditor value={value} maxLength={maxLength} onChange={onChange} />
);

for (const [name, editor] of [
  ["inline", inline],
  ["sidebar", sidebar],
] as const) {
  void test(`the ${name} string field editor stops at the field's maxLength`, async () => {
    const field = await render(editor("100M+", 7));

    await field.type("++");
    assert.equal(field.editable.textContent, "100M+++");
    assert.equal(field.saved.at(-1), "100M+++");

    await field.type("x");
    assert.equal(field.editable.textContent, "100M+++");
    assert.ok(
      field.saved.every((markdown) => markdown.length <= 7),
      `saved a value longer than 7: ${JSON.stringify(field.saved)}`,
    );

    await field.unmount();
  });

  void test(`the ${name} string field editor counts formatting toward maxLength`, async () => {
    // `**` around bold text is stored, so the API counts it.
    const field = await render(editor("**bold**", 9));

    await field.type("er");
    assert.equal(field.editable.textContent, "bold");
    assert.ok(
      field.saved.every((markdown) => markdown.length <= 9),
      `saved a value longer than 9: ${JSON.stringify(field.saved)}`,
    );

    await field.unmount();
  });

  void test(`the ${name} string field editor can shorten a value already over maxLength`, async () => {
    const field = await render(editor("too long", 3));

    await field.backspace();
    assert.equal(field.editable.textContent, "too lon");
    assert.equal(field.saved.at(-1), "too lon");

    await field.unmount();
  });
}
