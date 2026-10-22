import { describe, expect, it } from "vite-plus/test";

import { contentToMarkdown } from "./content-markdown";

const record = (id: string, name: string) => ({
  id,
  collectionId: "customers",
  title: name,
  description: null,
  content: { name },
  contentSchema: { properties: { name: { type: "string", fieldType: "String" } } },
});

describe("reference list Markdown", () => {
  it("falls back to each record's title without a per-use toMarkdown", () => {
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

describe("link Markdown", () => {
  const pageId = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c";
  const render = (link: unknown) =>
    contentToMarkdown(["{{cta}}"], { cta: { fieldType: "Link" } }, { cta: link });

  it("links the page a page link names", () => {
    expect(render({ type: "page", pageId, text: "About" })).toBe(`[About](camox:page:${pageId})`);
  });

  it("links an external link's href, like the website, even if it once linked a page", () => {
    expect(render({ type: "external", href: "https://camox.ai", pageId, text: "Camox" })).toBe(
      "[Camox](https://camox.ai)",
    );
  });
});
