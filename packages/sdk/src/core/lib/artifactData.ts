import type { TSchema } from "@sinclair/typebox";

/** The values of the sibling fields and settings an artifact receives as `camox.data`. */
export type ArtifactData = Record<string, unknown>;

/** Where an Artifact Data value comes from: the owner's content or its settings. */
type DataSource = { scope: "content" | "settings"; schema: TSchema };

// Kept off the synced definition: symbols never enter persisted JSON.
const DATA_SOURCES = Symbol("camox.artifactDataSources");

/** Content fields that can't be Artifact Data. */
const unsharedFieldTypes = new Set(["Artifact", "Repeater", "Reference", "ReferenceList"]);

const text = { type: "string" };

function objectSchema(properties: Record<string, unknown>, title?: string) {
  return {
    type: "object",
    ...(title === undefined ? {} : { title }),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const assetProperties = {
  Image: { url: text, alt: text },
  File: { url: text, filename: text },
} as const;

/** The JSON Schema of one normalized Artifact Data value. */
function valueSchema(schema: TSchema): Record<string, unknown> {
  const title = schema.title as string | undefined;
  const titled = title === undefined ? {} : { title };
  switch (schema.fieldType) {
    case "Link":
      return objectSchema({ text, href: text, newTab: { type: "boolean" } }, title);
    case "Image":
    case "File":
      return objectSchema(assetProperties[schema.fieldType as "Image" | "File"], title);
    case "ImageList":
    case "FileList": {
      const single = schema.fieldType === "ImageList" ? "Image" : "File";
      return { type: "array", ...titled, items: objectSchema(assetProperties[single]) };
    }
    case "Boolean":
      return { type: "boolean", ...titled };
    case "Enum":
      return { type: "string", ...titled, enum: schema.enum };
    default:
      return { type: "string", ...titled };
  }
}

/**
 * Resolves each artifact's `data` against its siblings: the content fields and settings of a
 * block, or of a repeatable item. Adds the Artifact Data's JSON Schema to the artifact's
 * definition, so `blocks describe` shows agents the exact shape of `camox.data`.
 */
export function attachArtifactData(
  content: Record<string, TSchema>,
  settings: Record<string, TSchema> | undefined,
  owner: string,
) {
  for (const [key, field] of Object.entries(content)) {
    if (field.fieldType !== "Artifact") continue;
    const names: readonly string[] = field.data ?? [];
    if (names.length === 0) continue;
    const sources: Record<string, DataSource> = {};
    for (const name of names) {
      const source = Object.hasOwn(content, name)
        ? { scope: "content" as const, schema: content[name] }
        : settings && Object.hasOwn(settings, name)
          ? { scope: "settings" as const, schema: settings[name] }
          : null;
      if (!source) {
        throw new Error(`${owner} artifact "${key}": data "${name}" is not a field or setting`);
      }
      if (unsharedFieldTypes.has(source.schema.fieldType)) {
        throw new Error(
          `${owner} artifact "${key}": ${String(source.schema.fieldType)} "${name}" can't be Artifact Data`,
        );
      }
      sources[name] = source;
    }
    field.dataSchema = objectSchema(
      Object.fromEntries(Object.entries(sources).map(([name, s]) => [name, valueSchema(s.schema)])),
    );
    Reflect.set(field, DATA_SOURCES, sources);
  }
}

/** How a block resolves the stored values that Artifact Data normalizes. */
export type ArtifactDataResolvers = {
  /** A stored link's href. */
  linkHref: (link: Record<string, unknown>) => string;
  /** A stored asset (or file marker) as a file, or nothing when it doesn't resolve. */
  asset: (value: unknown) => Record<string, unknown> | null | undefined;
};

function normalizeAsset(fieldType: string, file: Record<string, unknown> | null | undefined) {
  if (!file) return null;
  return fieldType === "Image" || fieldType === "ImageList"
    ? { url: file.url, alt: file.alt ?? "" }
    : { url: file.url, filename: file.filename ?? "" };
}

function normalizeValue(schema: TSchema, value: unknown, resolve: ArtifactDataResolvers) {
  switch (schema.fieldType) {
    case "Link": {
      const link = (value ?? {}) as Record<string, unknown>;
      return {
        text: typeof link.text === "string" ? link.text : "",
        href: resolve.linkHref(link),
        newTab: link.newTab === true,
      };
    }
    case "Image":
    case "File":
      return normalizeAsset(schema.fieldType, resolve.asset(value) ?? schema.default);
    case "ImageList":
    case "FileList":
      return (Array.isArray(value) ? value : [])
        .map((item) => normalizeAsset(schema.fieldType, resolve.asset(item)))
        .filter(Boolean);
    default:
      return value ?? schema.default;
  }
}

/**
 * The Artifact Data of an artifact field, from its owner's content and settings: links resolved
 * to hrefs and assets to URLs. Artifacts without `data` receive an empty object.
 */
export function artifactData(
  field: TSchema | undefined,
  owner: { content: Record<string, unknown>; settings: Record<string, unknown> },
  resolve: ArtifactDataResolvers,
): ArtifactData {
  const sources =
    field && (Reflect.get(field, DATA_SOURCES) as Record<string, DataSource> | undefined);
  if (!sources) return {};
  return Object.fromEntries(
    Object.entries(sources).map(([name, { scope, schema }]) => [
      name,
      normalizeValue(schema, owner[scope][name], resolve),
    ]),
  );
}
