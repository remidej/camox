import { expect, it } from "vitest";

import { markdownToLexicalState, lexicalStateToMarkdown } from "./lexical-state";

it("preserves singleton URL links in server-side markdown conversion", () => {
  const value = "[Explore Pokédex](/pokedex)";
  expect(lexicalStateToMarkdown(markdownToLexicalState(value))).toBe(value);
});
