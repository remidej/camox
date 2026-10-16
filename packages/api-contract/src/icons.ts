// One immutable snapshot for declarations, schemas, picker and SVG resolution.
export const ICON_CATALOG_VERSION = "2.2.532";
export type IconSvgData = {
  body: string;
  attributes: Record<string, string>;
  attribution?: { collection: string; author: string; license: string; url?: string };
};

export function scopeIconSvgIds(body: string, prefix: string): string {
  const ids = [...body.matchAll(/\sid="([^\s"]+)"/g)].map((match) => match[1]!);
  if (!ids.length) return body;
  const pattern = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return body.replace(
    new RegExp(`([#;"])(${pattern})([")]|\\.[a-z])`, "g"),
    (_match, before: string, id: string, after: string) => `${before}${prefix}${id}${after}`,
  );
}

export function validateIconValue(
  value: unknown,
  schema: { fieldType?: string; enum?: unknown },
): void {
  if (schema.fieldType !== "Icon") return;
  if (typeof value !== "string" || !Array.isArray(schema.enum) || !schema.enum.includes(value)) {
    throw new Error(`Invalid icon ID: ${String(value)}`);
  }
}
