import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { markdownToReactNodes } from "./lexicalReact";
import {
  lexicalStateToMarkdown,
  lexicalStateToPlainText,
  markdownToLexicalState,
  parseInlineMarkdown,
} from "./lexicalState";
import { FORMAT_FLAGS } from "./modifierFormats";
import { getHighlightStyle, type TextStyleData } from "./textStyles";

void test("singleton URL links survive editing round trips and render as internal links", () => {
  const value = "[Explore **Pokédex**](/pokedex)";
  assert.equal(lexicalStateToMarkdown(markdownToLexicalState(value)), value);
  const html = renderToStaticMarkup(markdownToReactNodes(value));
  assert.match(html, /href="\/pokedex"/);
  assert.match(html, /<strong>Pokédex<\/strong>/);
  assert.doesNotMatch(html, /target="_blank"/);
});

void test("bold, italic, and underline compose, including inside links", () => {
  const html = renderToStaticMarkup(
    markdownToReactNodes("[<u>***nimble***</u>](https://example.com)", {
      textStyle: ({ bold, italic, underline }) => ({
        className: bold && italic && underline ? "combined" : undefined,
        style: { color: "red" },
      }),
    }),
  );
  assert.match(
    html,
    /<strong class="combined" style="font-style:italic;text-decoration-line:underline;color:red">nimble<\/strong>/,
  );
  assert.match(html, /href="https:\/\/example.com"/);
});

void test("default highlight uses primary text color with an inherited-color fallback", () => {
  const expected = "var(--primary, currentColor)";
  assert.deepEqual(getHighlightStyle({}).style, { color: expected });
  const html = renderToStaticMarkup(markdownToReactNodes("<highlight>nimble</highlight>"));
  assert.ok(html.includes(expected));
  assert.equal(
    getHighlightStyle({
      textStyle: ({ highlight }) => (highlight ? { style: { color: "orange" } } : undefined),
    }).style?.color,
    "orange",
  );
});

void test("highlight has one boundary across formatting changes and links", () => {
  const value = "<highlight>stay **very** [*nimble*](https://example.com)</highlight>";
  const html = renderToStaticMarkup(markdownToReactNodes(value));
  assert.equal(html.match(/data-camox-highlight/g)?.length, 1);
  assert.match(html, /<strong>very<\/strong>/);
  assert.match(html, /<em>nimble<\/em>/);
  assert.equal(lexicalStateToMarkdown(markdownToLexicalState(value)), value);
  assert.equal(lexicalStateToPlainText(markdownToLexicalState(value)), "stay very nimble");
});

void test("textStyle resolves a highlight once, independently of its formatted children", () => {
  const calls: TextStyleData[] = [];
  const html = renderToStaticMarkup(
    markdownToReactNodes("<highlight>stay <u>***nimble***</u></highlight>", {
      textStyle: (flags) => {
        calls.push(flags);
        if (flags.highlight)
          return {
            className: "brand-highlight",
            style: {
              backgroundImage: "linear-gradient(orange, pink)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            },
          };
        if (flags.bold && flags.italic) return { className: "combined" };
        return undefined;
      },
    }),
  );
  assert.deepEqual(
    calls.filter(({ highlight }) => highlight),
    [{ highlight: true, bold: false, italic: false, underline: false }],
  );
  assert.ok(
    calls.some(
      ({ highlight, bold, italic, underline }) => !highlight && bold && italic && underline,
    ),
  );
  assert.equal(html.match(/linear-gradient\(orange, pink\)/g)?.length, 1);
  assert.equal(html.match(/brand-highlight/g)?.length, 1);
  assert.match(html, /background-clip:text/);
  assert.match(html, /-webkit-text-fill-color:transparent/);
  assert.match(html, /<strong class="combined"/);
});

void test("formatting round trips nested and adjacent runs", () => {
  for (const value of [
    "**bold *both***",
    "***both* bold**",
    "*italic **both***",
    "***both** italic*",
    "<highlight><u>***both***</u>\nplain</highlight>",
    "<highlight>first\n\nsecond</highlight>",
    "first\n\nsecond\nthird",
    "_italic_ __bold__ ___both___",
    "snake_case",
    "\\*literal\\* \\<highlight>literal\\</highlight>",
  ]) {
    const state = markdownToLexicalState(value);
    const saved = lexicalStateToMarkdown(state);
    assert.deepEqual(markdownToLexicalState(saved), state, `${value} -> ${saved}`);
  }
});

void test("all adjacent format combinations preserve whitespace and punctuation", () => {
  const formats = [0, 1, 2, 3, 8, 9, 10, 11];
  const values = ["word", " word ", "* _ [ ] < > & 😀"];
  const characters = (nodes: any[]): unknown[] =>
    nodes.flatMap((node) => [...node.text].map((letter) => [letter, node.format]));
  for (const first of formats) {
    for (const second of formats) {
      for (const value of values) {
        const nodes = [first, second].map((format) => ({
          ...parseInlineMarkdown("word")[0],
          text: value,
          format,
        }));
        const state = {
          root: { type: "root", children: [{ type: "paragraph", children: nodes }] },
        };
        const saved = lexicalStateToMarkdown(state);
        assert.deepEqual(characters(parseInlineMarkdown(saved)), characters(nodes), saved);
      }
    }
  }
});

void test("legacy Lexical objects and strings retain formatting", () => {
  const state = markdownToLexicalState("<highlight>***nimble***</highlight>");
  assert.equal(
    renderToStaticMarkup(markdownToReactNodes(state)),
    renderToStaticMarkup(markdownToReactNodes(JSON.stringify(state))),
  );
  assert.equal(
    parseInlineMarkdown("***both***")[0].format,
    FORMAT_FLAGS.bold | FORMAT_FLAGS.italic,
  );
});

void test("HTML and unsafe links are not rendered as executable markup", () => {
  const html = renderToStaticMarkup(
    markdownToReactNodes(
      '<script>alert(1)</script> [bad](javascript:alert) <highlight onclick="alert(1)">text</highlight>',
    ),
  );
  assert.doesNotMatch(html, /<script|href="javascript:|<highlight/);
  assert.match(html, /&lt;script&gt;/);
});
