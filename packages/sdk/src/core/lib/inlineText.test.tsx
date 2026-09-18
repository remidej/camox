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
import { getGradientStyle, type TextStyleData } from "./textStyles";

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

void test("default gradient uses chart colors with theme and inherited-color fallbacks", () => {
  const expected =
    "linear-gradient(to right, var(--camox-gradient-from, var(--chart-1, var(--primary, currentColor))), var(--camox-gradient-to, var(--chart-2, var(--muted-foreground, currentColor))))";
  assert.equal(getGradientStyle({}).style?.backgroundImage, expected);
  const html = renderToStaticMarkup(markdownToReactNodes("<gradient>nimble</gradient>"));
  assert.ok(html.includes(expected));
  assert.equal(
    getGradientStyle({
      textStyle: ({ gradient }) =>
        gradient ? { style: { backgroundImage: "linear-gradient(orange, pink)" } } : undefined,
    }).style?.backgroundImage,
    "linear-gradient(orange, pink)",
  );
});

void test("gradient has one boundary across formatting changes and links", () => {
  const value = "<gradient>stay **very** [*nimble*](https://example.com)</gradient>";
  const html = renderToStaticMarkup(markdownToReactNodes(value));
  assert.equal(html.match(/data-camox-gradient/g)?.length, 1);
  assert.match(html, /<strong>very<\/strong>/);
  assert.match(html, /<em>nimble<\/em>/);
  assert.equal(lexicalStateToMarkdown(markdownToLexicalState(value)), value);
  assert.equal(lexicalStateToPlainText(markdownToLexicalState(value)), "stay very nimble");
});

void test("textStyle resolves a gradient once, independently of its formatted children", () => {
  const calls: TextStyleData[] = [];
  const html = renderToStaticMarkup(
    markdownToReactNodes("<gradient>stay <u>***nimble***</u></gradient>", {
      textStyle: (flags) => {
        calls.push(flags);
        if (flags.gradient)
          return {
            className: "brand-gradient",
            style: { backgroundImage: "linear-gradient(orange, pink)" },
          };
        if (flags.bold && flags.italic) return { className: "combined" };
        return undefined;
      },
    }),
  );
  assert.deepEqual(
    calls.filter(({ gradient }) => gradient),
    [{ gradient: true, bold: false, italic: false, underline: false }],
  );
  assert.ok(
    calls.some(({ gradient, bold, italic, underline }) => !gradient && bold && italic && underline),
  );
  assert.equal(html.match(/linear-gradient\(orange, pink\)/g)?.length, 1);
  assert.equal(html.match(/brand-gradient/g)?.length, 1);
  assert.match(html, /<strong class="combined"/);
});

void test("formatting round trips nested and adjacent runs", () => {
  for (const value of [
    "**bold *both***",
    "***both* bold**",
    "*italic **both***",
    "***both** italic*",
    "<gradient><u>***both***</u>\nplain</gradient>",
    "<gradient>first\n\nsecond</gradient>",
    "first\n\nsecond\nthird",
    "_italic_ __bold__ ___both___",
    "snake_case",
    "\\*literal\\* \\<gradient>literal\\</gradient>",
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
  const state = markdownToLexicalState("<gradient>***nimble***</gradient>");
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
      '<script>alert(1)</script> [bad](javascript:alert) <gradient onclick="alert(1)">text</gradient>',
    ),
  );
  assert.doesNotMatch(html, /<script|href="javascript:|<gradient/);
  assert.match(html, /&lt;script&gt;/);
});
