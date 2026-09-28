import { describe, expect, it } from "vitest";

import { contentWithSeeds, prepareBlockContent } from "./prepare-content";

describe("block bundle preparation", () => {
  it("does not mutate legacy arrays while reconstructing a validation view", () => {
    const content = { legacy: [] };
    const seeds = [
      {
        tempId: "one",
        parentTempId: null,
        fieldName: "legacy",
        position: "a0",
        content: { title: "Item" },
      },
    ];
    expect(contentWithSeeds(content, seeds, undefined)).toEqual({ legacy: [{ title: "Item" }] });
    expect(content).toEqual({ legacy: [] });
  });

  it("rejects scalar seed collisions with a structured error", () => {
    expect(() =>
      prepareBlockContent(
        { title: "Title" },
        undefined,
        [
          {
            tempId: "one",
            parentTempId: null,
            fieldName: "title",
            position: "a0",
            content: {},
          },
        ],
        { properties: { title: { type: "string" } } },
        undefined,
      ),
    ).toThrow("not a repeater");
  });

  it("keeps local schema references available to detached explicit and inline seeds", () => {
    const schema = {
      $defs: { title: { type: "string", minLength: 1 } },
      properties: {
        items: {
          type: "array",
          fieldType: "Repeater",
          items: {
            type: "object",
            properties: { title: { $ref: "#/$defs/title" } },
            required: ["title"],
          },
        },
      },
    };
    const seed = {
      tempId: "one",
      parentTempId: null,
      fieldName: "items",
      position: "a0",
      content: { title: "Valid" },
    };
    expect(prepareBlockContent({}, undefined, [seed], schema, undefined).seeds[0].content).toEqual({
      title: "Valid",
    });
    expect(
      prepareBlockContent({ items: [{ title: "Valid" }] }, undefined, undefined, schema, undefined)
        .seeds[0].content,
    ).toEqual({ title: "Valid" });
    expect(() =>
      prepareBlockContent({}, undefined, [{ ...seed, content: { title: 42 } }], schema, undefined),
    ).toThrow();
  });
});
