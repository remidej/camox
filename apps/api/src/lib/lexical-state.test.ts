import { expect, it } from "vitest";

import {
  markdownToLexicalState,
  lexicalStateToMarkdown,
  lexicalStateToPlainText,
} from "./lexical-state";

it("preserves singleton URL links in server-side markdown conversion", () => {
  const value = "[Explore Pokédex](/pokedex)";
  expect(lexicalStateToMarkdown(markdownToLexicalState(value))).toBe(value);
});

it("extracts inline link formatting as contiguous text for String constraints and labels", () => {
  expect(
    lexicalStateToPlainText(markdownToLexicalState("[Hello **world**](https://example.com)")),
  ).toBe("Hello world");
});
