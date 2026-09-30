import { ORPCError } from "@orpc/server";

import { stableStringify } from "../../lib/stable-stringify";
import type { ServiceContext } from "../_shared/service-context";
import { contentSchemaInput, validateContent } from "./validation";

/** Only additions are automatic; existing fields retain their exact contract. */
export async function collectionAdditionDefaults(
  ctx: ServiceContext,
  previousSchema: unknown,
  definition: { projectId: number; environmentId: number; contentSchema: unknown },
): Promise<Record<string, unknown>> {
  const previous = contentSchemaInput.parse(previousSchema);
  const next = contentSchemaInput.parse(definition.contentSchema);
  for (const [key, field] of Object.entries(previous.properties)) {
    if (stableStringify(field) !== stableStringify(next.properties[key])) {
      throw new ORPCError("CONFLICT", {
        message: `Collection field "${key}" cannot be changed or removed while records exist`,
      });
    }
  }
  const properties = Object.fromEntries(
    Object.entries(next.properties).filter(([key]) => !Object.hasOwn(previous.properties, key)),
  );
  const defaults = Object.fromEntries(
    Object.entries(properties).map(([key, field]) => {
      // Asset defaults are preview placeholders, never authored record content.
      if (field.fieldType === "Image" || field.fieldType === "File") return [key, null];
      if (field.fieldType.endsWith("List")) return [key, []];
      if (field.default !== undefined) return [key, field.default];
      if (field.fieldType === "Boolean") return [key, false];
      if (field.fieldType === "Enum") return [key, field.enum?.[0]];
      return [key, ""];
    }),
  );
  try {
    return await validateContent(
      ctx,
      {
        ...definition,
        contentSchema: { ...next, properties, required: Object.keys(properties) },
      },
      defaults,
    );
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "BAD_REQUEST") throw error;
    throw new ORPCError("CONFLICT", {
      message: `New collection fields need valid initial values: ${error.message}`,
      cause: error,
    });
  }
}
