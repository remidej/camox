import { describe, expect, it } from "vitest";

import { contentToMarkdown } from "./content-markdown";

const record = (id: string, name: string) => ({
  id,
  collectionId: "customers",
  label: name,
  content: { name },
  contentSchema: { properties: { name: { type: "string", fieldType: "String" } } },
});

describe("reference list Markdown", () => {
  it("falls back to each record's label without a per-use toMarkdown", () => {
    const markdown = contentToMarkdown(
      ["{{customers}}"],
      { customers: { fieldType: "ReferenceList" } },
      { customers: ["b", "a"] },
      { references: { customers: [record("b", "Beta"), record("a", "Alpha")] } },
    );
    expect(markdown).toBe("- Beta\n- Alpha");
  });
});
