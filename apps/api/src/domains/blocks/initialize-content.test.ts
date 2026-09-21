import { describe, expect, it } from "vitest";

import { initializeBlockContent } from "./initialize-content";
import { normalizeBlockContent } from "./normalize-content";

const schema = {
  properties: {
    title: { fieldType: "String", default: "Welcome" },
    link: { fieldType: "Link", default: { text: "Learn more", href: "/" } },
    visible: { fieldType: "Boolean", default: true },
    count: { default: 3 },
    image: { fieldType: "Image", default: { url: "placeholder" } },
    gallery: { fieldType: "ImageList", defaultItems: 3 },
    sections: {
      fieldType: "Repeater",
      minItems: 1,
      items: {
        properties: {
          title: { default: "Section" },
          cards: {
            fieldType: "Repeater",
            minItems: 1,
            items: { properties: { title: { default: "Card" } } },
          },
        },
      },
    },
  },
};

const initialize = (content: unknown, seedRepeaters = true) =>
  normalizeBlockContent(initializeBlockContent(content, schema, seedRepeaters), schema);

describe("block creation defaults", () => {
  it.each([{}, undefined])("initializes omitted fields and nested repeater rows: %j", (content) => {
    const result = initialize(content);
    expect(result.content).toEqual({
      title: "Welcome",
      link: { text: "Learn more", href: "/" },
      visible: true,
      count: 3,
    });
    expect(result.seeds).toHaveLength(2);
    expect(result.seeds[0]).toMatchObject({ fieldName: "sections", content: { title: "Section" } });
    expect(result.seeds[1]).toMatchObject({
      parentTempId: result.seeds[0].tempId,
      fieldName: "cards",
      content: { title: "Card" },
    });
  });

  it("preserves explicit emptiness, null, false, zero, and unknown fields", () => {
    const result = initialize({
      title: "",
      link: null,
      visible: false,
      count: 0,
      sections: [],
      extra: "custom",
    });
    expect(result.content).toEqual({
      title: "",
      link: null,
      visible: false,
      count: 0,
      extra: "custom",
    });
    expect(result.seeds).toEqual([]);
  });

  it("fills partial items without appending defaults or replacing nested empty repeaters", () => {
    const result = initialize({ sections: [{ title: "Custom", cards: [] }, { cards: [] }] });
    expect(result.seeds.map((seed) => seed.content)).toEqual([
      { title: "Custom" },
      { title: "Section" },
    ]);
  });

  it("does not generate repeaters when the caller supplies a seed bundle", () => {
    expect(initialize({}, false).seeds).toEqual([]);
    expect(initialize({}, false).content.title).toBe("Welcome");
  });

  it("preserves supplied links as whole field values", () => {
    expect(initialize({ link: { text: "Custom", href: "/custom" } }).content.link).toEqual({
      text: "Custom",
      href: "/custom",
    });
  });

  it("does not hide invalid repeater values from normalization", () => {
    expect(() => initialize({ sections: [null] })).toThrow(/element must be an object/);
    expect(() => initialize({ sections: "invalid" })).toThrow(/expected an array/);
    expect(() => initialize({ sections: [{ _itemId: 1 }] })).toThrow(
      /cannot reference existing items/,
    );
  });

  it("works without a definition and does not mutate input or defaults", () => {
    expect(initializeBlockContent({ title: "Custom" }, undefined)).toEqual({ title: "Custom" });
    const content = { sections: [{ cards: [] }] };
    initialize(content);
    expect(content).toEqual({ sections: [{ cards: [] }] });
    const first = initializeBlockContent({}, schema);
    (first.link as { text: string }).text = "Changed";
    expect(initialize({}).content.link).toEqual({ text: "Learn more", href: "/" });
  });
});
