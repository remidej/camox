import { uuidv7JsonSchema, uuidv7Schema } from "@camox/api-contract/ids";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

describe("uuidv7JsonSchema", () => {
  it("matches the JSON Schema zod derives from uuidv7Schema", () => {
    const { $schema: _, ...derived } = z.toJSONSchema(uuidv7Schema);
    expect(uuidv7JsonSchema).toEqual(derived);
  });
});
