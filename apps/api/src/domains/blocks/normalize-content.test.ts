import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { normalizeBlockContent, validateItemSeeds } from "./normalize-content";

const FILE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";

const embed = { type: "string", fieldType: "Embed", pattern: "^https://example\\.com/" };
const properties = {
  embed,
  videos: {
    fieldType: "Repeater",
    items: { properties: { embed } },
  },
};
const url = "https://example.com/video";

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

describe("validateItemSeeds", () => {
  it("resolves nested explicit seeds and rejects ambiguous parent ordering", () => {
    const seeds = [
      {
        tempId: "child",
        parentTempId: "parent",
        fieldName: "videos",
        content: { embed: { url } },
        position: "a0",
      },
      {
        tempId: "parent",
        parentTempId: null,
        fieldName: "groups",
        content: {},
        position: "a0",
      },
    ];
    expect(() => Effect.runSync(validateItemSeeds(seeds, properties))).toThrow(
      "Repeater seed parent must precede its child",
    );
    expect(() =>
      Effect.runSync(
        validateItemSeeds([...seeds].reverse(), {
          groups: { fieldType: "Repeater", items: { properties } },
        }),
      ),
    ).toThrow("repeatableItems[1].content.embed");
    expect(() => Effect.runSync(validateItemSeeds([seeds[1], seeds[1]], properties))).toThrow(
      "Duplicate repeater seed tempId",
    );
    expect(() =>
      Effect.runSync(validateItemSeeds([{ ...seeds[1], tempId: "" }], properties)),
    ).toThrow("Repeater seed tempId must not be empty");
  });
});
