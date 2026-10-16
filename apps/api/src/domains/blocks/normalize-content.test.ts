import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { normalizeBlockContent } from "./normalize-content";

const FILE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";

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

    const result = Effect.runSync(
      normalizeBlockContent(
        {
          hero: { _fileId: FILE_ID, url: "https://untrusted.example/image.png" },
          sections: [{ title: "Section", cards: [{ title: "Card" }] }],
        },
        schema,
      ),
    );

    expect(result.content).toEqual({ hero: { _fileId: FILE_ID } });
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
      Effect.runSync(
        normalizeBlockContent(
          { sections: [{ _itemId: 12 }] },
          {
            properties: {
              sections: { fieldType: "Repeater", items: { properties: {} } },
            },
          },
        ),
      ),
    ).toThrow(/_itemId/);
  });
});
