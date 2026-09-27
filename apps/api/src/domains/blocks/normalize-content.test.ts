import { describe, expect, it } from "vitest";

import { normalizeBlockContent } from "./normalize-content";

describe("normalizeBlockContent", () => {
  it("extracts nested repeaters and strips untrusted asset properties", () => {
    const schema = {
      properties: {
        hero: { fieldType: "Image" },
        sections: {
          fieldType: "Repeater",
          items: {
            properties: {
              title: { fieldType: "String" },
              cards: {
                fieldType: "Repeater",
                items: { properties: { title: { fieldType: "String" } } },
              },
            },
          },
        },
      },
    };

    const result = normalizeBlockContent(
      {
        hero: { _fileId: "42", url: "https://untrusted.example/image.png" },
        sections: [{ title: "Section", cards: [{ title: "Card" }] }],
      },
      schema,
    );

    expect(result.content).toEqual({ hero: { _fileId: 42 } });
    expect(result.seeds).toHaveLength(2);
    expect(result.seeds[0]).toMatchObject({
      parentTempId: null,
      fieldName: "sections",
      content: { title: "Section" },
    });
    expect(result.seeds[1]).toMatchObject({
      parentTempId: result.seeds[0].tempId,
      fieldName: "cards",
      content: { title: "Card" },
    });
  });

  it("rejects references to existing repeatable items during creation", () => {
    expect(() =>
      normalizeBlockContent(
        { sections: [{ _itemId: 12 }] },
        {
          properties: {
            sections: { fieldType: "Repeater", items: { properties: {} } },
          },
        },
      ),
    ).toThrow(/_itemId/);
  });
});
