import { Validator, type Schema } from "@cfworker/json-schema";
import { ORPCError } from "@orpc/server";

import { sanitizeAssetValue } from "./asset-value";

export type ContentSchema = Schema & { fieldType?: string };
export type SchemaProps = Record<string, ContentSchema | boolean>;

type Options = {
  path?: string;
  partial?: boolean;
  allowItemReferences?: boolean;
  /** Original document when validating a detached subschema with local references. */
  rootSchema?: unknown;
};

type AdaptContext = {
  root: ContentSchema | boolean;
  definitions: SchemaProps;
  references: Map<string, string>;
  namespace: string;
};

const assetTypes = new Set(["Image", "File", "ImageList", "FileList"]);
const assetSchema: Schema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: { _fileId: { type: "number" } },
      required: ["_fileId"],
      additionalProperties: false,
    },
  ],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSingleAsset(schema: ContentSchema): boolean {
  return schema.fieldType === "Image" || schema.fieldType === "File";
}

/**
 * Validate stored content, not the hydrated render representation in the SDK.
 * The JSON Schema engine owns scalar/collection constraints; this adapter only
 * accounts for patch semantics, asset storage and persisted repeater references.
 * Neither the caller's content nor its schema is modified.
 */
export function validateContent(value: unknown, schema: unknown, options: Options = {}): void {
  const path = options.path ?? "content";
  if (!isObject(value)) {
    fail([{ path, message: "Expected an object" }]);
  }
  if (!isObject(schema) && typeof schema !== "boolean") return;

  // The validator annotates schemas while resolving references. Own every node.
  const source = structuredClone(schema) as ContentSchema | boolean;
  const root = structuredClone(options.rootSchema ?? source) as ContentSchema | boolean;
  let namespace = "__contentReferences";
  while (typeof source === "object" && source.$defs?.[namespace] !== undefined) namespace += "_";
  const context: AdaptContext = { root, definitions: {}, references: new Map(), namespace };
  const adapted = adaptSchema(
    source,
    options.partial ?? true,
    options.allowItemReferences ?? false,
    context,
  );
  if (typeof adapted === "object" && Object.keys(context.definitions).length) {
    adapted.$defs = {
      ...adapted.$defs,
      [namespace]: { $defs: context.definitions },
    };
  }
  const result = new Validator(adapted, "2019-09", false).validate(project(value, source));
  if (result.valid) return;

  // Applicators emit summary errors before their actionable leaf errors.
  const errors = result.errors.filter(
    (error) =>
      !result.errors.some((other) => other.keywordLocation.startsWith(`${error.keywordLocation}/`)),
  );
  fail(
    errors.map((error) => ({
      path: instancePath(path, error.instanceLocation, value),
      message: error.error,
    })),
  );
}

function fail(errors: { path: string; message: string }[]): never {
  const first = errors[0];
  throw new ORPCError("BAD_REQUEST", {
    message: `Invalid value at ${first.path}: ${first.message}`,
    data: { field: first.path, errors },
  });
}

function instancePath(root: string, pointer: string, value: unknown): string {
  let path = root;
  let current = value;
  for (const encoded of pointer.replace(/^#/, "").split("/").slice(1)) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    path += Array.isArray(current) ? `[${key}]` : `.${key}`;
    current =
      isObject(current) || Array.isArray(current)
        ? (current as Record<string, unknown>)[key]
        : undefined;
  }
  return path;
}

function adaptSchema(
  schema: ContentSchema | boolean,
  partial: boolean,
  allowItemReferences: boolean,
  context: AdaptContext,
  itemReference = false,
): ContentSchema | boolean {
  if (typeof schema === "boolean") return schema;
  if (isSingleAsset(schema)) return structuredClone(assetSchema);
  if (schema.fieldType === "Reference") {
    return { anyOf: [{ type: "null" }, { type: "string", format: "uuid" }] };
  }

  const out: ContentSchema = { ...schema };
  if (schema.$ref?.startsWith("#")) {
    const target = resolveLocalReference(context.root, schema.$ref);
    if (target !== undefined) {
      const key = `${schema.$ref}:${partial}:${itemReference}`;
      let reference = context.references.get(key);
      if (!reference) {
        const name = String(context.references.size);
        reference = `#/$defs/${context.namespace}/$defs/${name}`;
        // Reserve before descending so recursive references reuse the same variant.
        context.references.set(key, reference);
        context.definitions[name] = adaptSchema(
          target,
          partial,
          allowItemReferences,
          context,
          itemReference,
        );
      }
      out.$ref = reference;
    }
  }
  for (const keyword of ["properties", "patternProperties", "$defs", "definitions"] as const) {
    const entries = schema[keyword] as SchemaProps | undefined;
    if (!entries) continue;
    out[keyword] = Object.fromEntries(
      Object.entries(entries).map(([key, child]) => [
        key,
        adaptSchema(child, false, allowItemReferences, context),
      ]),
    );
  }
  if (partial) {
    delete out.required;
  } else if (schema.required) {
    out.required = schema.required.filter((key) => {
      const property = schema.properties?.[key];
      return typeof property !== "object" || !assetTypes.has(property.fieldType);
    });
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (!schema[keyword]) continue;
    out[keyword] = schema[keyword].map(
      (child) => adaptSchema(child, partial, allowItemReferences, context, itemReference) as Schema,
    );
  }
  if (partial && out.oneOf) {
    // Missing discriminating required fields can make several completions possible.
    // Patches need a compatible branch, not the exclusivity of a full replacement.
    const compatible = { anyOf: out.oneOf };
    out.allOf = [...(out.allOf ?? []), compatible];
    delete out.oneOf;
  }
  if (itemReference) {
    out.properties = { ...out.properties, _itemId: { type: "integer", minimum: 1 } };
  }
  for (const keyword of [
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "additionalItems",
    "unevaluatedItems",
    "contains",
    "not",
    "if",
    "then",
    "else",
  ] as const) {
    const child = schema[keyword];
    if (child === undefined) continue;
    out[keyword] = adaptSchema(
      child,
      (keyword === "then" || keyword === "else") && partial,
      allowItemReferences,
      context,
      (keyword === "then" || keyword === "else") && itemReference,
    ) as Schema;
  }
  if (schema.items !== undefined) {
    out.items = Array.isArray(schema.items)
      ? schema.items.map((child) => adaptSchema(child, false, allowItemReferences, context))
      : adaptSchema(schema.items, false, allowItemReferences, context);
  }
  if (schema.prefixItems) {
    out.prefixItems = schema.prefixItems.map((child) =>
      adaptSchema(child, false, allowItemReferences, context),
    );
  }

  if (schema.fieldType === "ImageList" || schema.fieldType === "FileList") {
    out.items = structuredClone(assetSchema);
  }
  if (schema.fieldType !== "Repeater") return out;

  out.type = "array";
  if (schema.items === false) return out;
  const item = isObject(schema.items) ? (schema.items as ContentSchema) : {};
  const fresh = adaptSchema(item, false, allowItemReferences, context) as ContentSchema;
  fresh.type = "object";
  fresh.properties = { ...fresh.properties, _itemId: false };
  if (!allowItemReferences) {
    out.items = fresh;
    return out;
  }
  const reference = adaptSchema(item, true, allowItemReferences, context, true) as ContentSchema;
  reference.type = "object";
  reference.properties = {
    ...reference.properties,
    _itemId: { type: "integer", minimum: 1 },
  };
  out.items = {
    if: { required: ["_itemId"] },
    // JSON Schema's conditional keyword is data, not a Promise method.
    // eslint-disable-next-line unicorn/no-thenable
    then: reference,
    else: fresh,
  };
  return out;
}

function resolveLocalReference(
  root: ContentSchema | boolean,
  reference: string,
): ContentSchema | boolean | undefined {
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const part of decodeURIComponent(reference.slice(2)).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if ((!isObject(current) && !Array.isArray(current)) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "boolean" || isObject(current)
    ? (current as ContentSchema | boolean)
    : undefined;
}

/**
 * Match the normalizer's asset canonicalization in a validation-only projection.
 * All non-asset values retain their types: never coerce numbers, booleans, etc.
 */
function project(value: unknown, schema: ContentSchema | boolean): unknown {
  if (typeof schema === "boolean") return value;
  if (isSingleAsset(schema)) return sanitizeAssetValue(value);
  if (Array.isArray(value)) {
    if (schema.fieldType === "ImageList" || schema.fieldType === "FileList") {
      return value.map(sanitizeAssetValue);
    }
    return value.map((item, index) => {
      const child =
        schema.prefixItems?.[index] ??
        (Array.isArray(schema.items) ? schema.items[index] : schema.items);
      return child === undefined ? item : project(item, child);
    });
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      schema.properties?.[key] === undefined ? child : project(child, schema.properties[key]),
    ]),
  );
}
