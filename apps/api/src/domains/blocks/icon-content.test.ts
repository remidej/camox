import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { normalizeBlockContent, sanitizeItemContent } from "./normalize-content";
import { validateContent } from "./validate-content";

const icon = { type: "string", fieldType: "Icon", enum: ["lucide:zap", "lucide:house"] };
const schema = {
  properties: { icon, items: { fieldType: "Repeater", items: { properties: { icon } } } },
};

describe("icon content validation", () => {
  it("preserves namespaced IDs in blocks and repeater seeds", () => {
    const result = Effect.runSync(
      normalizeBlockContent({ icon: "lucide:zap", items: [{ icon: "lucide:house" }] }, schema),
    );
    expect(result.content.icon).toBe("lucide:zap");
    expect(result.seeds[0]?.content).toEqual({ icon: "lucide:house" });
    expect(Effect.runSync(sanitizeItemContent({ icon: "lucide:zap" }, { icon }))).toEqual({
      icon: "lucide:zap",
    });
  });
  it.each([null, "", "zap", "mdi:zap", "lucide:missing", 123, {}])(
    "rejects invalid ID %j on every write path",
    (value) => {
      expect(() => Effect.runSync(normalizeBlockContent({ icon: value }, schema))).toThrow();
      expect(() =>
        Effect.runSync(normalizeBlockContent({ items: [{ icon: value }] }, schema)),
      ).toThrow();
      expect(() => Effect.runSync(sanitizeItemContent({ icon: value }, { icon }))).toThrow();
      expect(() =>
        Effect.runSync(validateContent({ icon: value }, { properties: { icon } })),
      ).toThrow();
    },
  );
});
