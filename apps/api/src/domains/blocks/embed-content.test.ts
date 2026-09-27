import { describe, expect, it } from "vitest";

import {
  normalizeBlockContent,
  sanitizeItemContent,
  validateEmbedContent,
  validateEmbedSeeds,
} from "./normalize-content";

const embed = { fieldType: "Embed", pattern: "^https://example\\.com/" };
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
      validateEmbedContent({ videos: [{ embed: url }, { embed: { url } }] }, properties),
    ).toThrow("Invalid value at content.videos[1].embed: expected a string, received object");
    try {
      validateEmbedContent({ videos: [{ embed: 42 }] }, properties);
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        data: { field: "content.videos[0].embed" },
      });
    }
  });

  it("accepts matching strings and omitted fields without imposing additional URL rules", () => {
    expect(normalizeBlockContent({ embed: url }, { properties }).content).toEqual({ embed: url });
    expect(() => validateEmbedContent({ title: "Updated" }, properties)).not.toThrow();
    expect(() =>
      validateEmbedContent({ embed: "" }, { embed: { fieldType: "Embed", pattern: ".*" } }),
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
    expect(() => validateEmbedSeeds(seeds, properties)).toThrow(
      "Repeater seed parent must precede its child",
    );
    expect(() =>
      validateEmbedSeeds([...seeds].reverse(), {
        groups: { fieldType: "Repeater", items: { properties } },
      }),
    ).toThrow("repeatableItems[1].content.embed");
    expect(() => validateEmbedSeeds([seeds[1], seeds[1]], properties)).toThrow(
      "Duplicate repeater seed tempId",
    );
    expect(() => validateEmbedSeeds([{ ...seeds[1], tempId: "" }], properties)).toThrow(
      "Repeater seed tempId must not be empty",
    );
  });
});
