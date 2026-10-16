import { describe, expect, it } from "vite-plus/test";

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

describe("file Markdown", () => {
  const fileId = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
  const file = {
    url: "https://assets.example.com/hero.pdf",
    alt: "Hero",
    filename: "hero.pdf",
    mimeType: "application/pdf",
  };

  it("resolves a `_fileId` to the file it names", () => {
    const markdown = contentToMarkdown(
      ["{{brochure}}"],
      { brochure: { fieldType: "File" } },
      { brochure: { _fileId: fileId } },
      { files: new Map([[fileId, file]]) },
    );
    expect(markdown).toBe("[hero.pdf](https://assets.example.com/hero.pdf)");
  });

  it("keeps an asset snapshot that carries its own URL", () => {
    const snapshot = { ...file, filename: "snapshot.pdf", url: "https://assets.example.com/a.pdf" };
    const markdown = contentToMarkdown(
      ["{{brochure}}"],
      { brochure: { fieldType: "File" } },
      { brochure: { ...snapshot, _fileId: fileId } },
      { files: new Map([[fileId, file]]) },
    );
    expect(markdown).toBe("[snapshot.pdf](https://assets.example.com/a.pdf)");
  });
});
