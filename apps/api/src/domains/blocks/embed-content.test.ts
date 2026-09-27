import { describe, expect, it } from "vitest";

import { normalizeBlockContent, sanitizeItemContent, validateItemSeeds } from "./normalize-content";
import { validateContent } from "./validate-content";

const embed = { type: "string", fieldType: "Embed", pattern: "^https://example\\.com/" };
const properties = {
  embed,
  videos: {
    fieldType: "Repeater",
    items: { properties: { embed } },
  },
};
const url = "https://example.com/video";

describe("Embed validation", () => {
  it.each([null, {}, { url }, [], 1, true, "", "https://other.com/video"])(
    "rejects invalid values through normalization and direct item writes: %j",
    (value) => {
      expect(() => normalizeBlockContent({ embed: value }, { properties })).toThrow();
      expect(() => sanitizeItemContent({ embed: value }, properties)).toThrow();
    },
  );

  it("reports the submitted path without coercing objects", () => {
    expect(() =>
      validateContent({ videos: [{ embed: url }, { embed: { url } }] }, { properties }),
    ).toThrow("content.videos[1].embed");
    try {
      validateContent({ videos: [{ embed: 42 }] }, { properties });
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        data: { field: "content.videos[0].embed" },
      });
    }
  });

  it("accepts matching strings and omitted fields without imposing additional URL rules", () => {
    expect(normalizeBlockContent({ embed: url }, { properties }).content).toEqual({ embed: url });
    expect(() => validateContent({ title: "Updated" }, { properties })).not.toThrow();
    expect(() =>
      validateContent({ embed: "" }, { properties: { embed: { ...embed, pattern: ".*" } } }),
    ).not.toThrow();
  });

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
    expect(() => validateItemSeeds(seeds, properties)).toThrow(
      "Repeater seed parent must precede its child",
    );
    expect(() =>
      validateItemSeeds([...seeds].reverse(), {
        groups: { fieldType: "Repeater", items: { properties } },
      }),
    ).toThrow("repeatableItems[1].content.embed");
    expect(() => validateItemSeeds([seeds[1], seeds[1]], properties)).toThrow(
      "Duplicate repeater seed tempId",
    );
    expect(() => validateItemSeeds([{ ...seeds[1], tempId: "" }], properties)).toThrow(
      "Repeater seed tempId must not be empty",
    );
  });
});
