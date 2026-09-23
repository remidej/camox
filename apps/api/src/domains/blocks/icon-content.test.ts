import { describe, expect, it } from "vitest";

import { normalizeBlockContent, sanitizeItemContent, assertIconValue } from "./normalize-content";

const icon = { fieldType: "Icon", enum: ["lucide:zap", "lucide:house"] };
const schema = {
  properties: { icon, items: { fieldType: "Repeater", items: { properties: { icon } } } },
};

describe("icon content validation", () => {
  it("preserves namespaced IDs in blocks and repeater seeds", () => {
    const result = normalizeBlockContent(
      { icon: "lucide:zap", items: [{ icon: "lucide:house" }] },
      schema,
    );
    expect(result.content.icon).toBe("lucide:zap");
    expect(result.seeds[0]?.content).toEqual({ icon: "lucide:house" });
    expect(sanitizeItemContent({ icon: "lucide:zap" }, { icon })).toEqual({ icon: "lucide:zap" });
  });
  it.each([null, "", "zap", "mdi:zap", "lucide:missing", 123, {}])(
    "rejects invalid ID %j on every write path",
    (value) => {
      expect(() => normalizeBlockContent({ icon: value }, schema)).toThrow();
      expect(() => normalizeBlockContent({ items: [{ icon: value }] }, schema)).toThrow();
      expect(() => sanitizeItemContent({ icon: value }, { icon })).toThrow();
      expect(() => assertIconValue(value, icon, "icon")).toThrow();
    },
  );
});
