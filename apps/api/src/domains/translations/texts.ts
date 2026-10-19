import slugify from "slugify";

import type { TranslationText } from "../../lib/ai-model";
import { isLexicalState } from "../../lib/lexical-state";
import { fieldsOf } from "../_shared/fields";
import type { Values } from "./bookkeeping";

// The fields of a localization a translation job merges one by one (ADR 0015), read from its
// stored schema, and the texts it sends the model for each. A field is a column, a key of the
// content or a key of the settings. Text fields, link labels and artifact sources are translated;
// every other value is copied as it is, ids included, so references and links keep pointing at
// the same entities in the localization's locale.

type Format = TranslationText["format"];

/** What a localization holds, beyond what its stored schema says. */
export type Shape = {
  /** The stored schema of its content, which says which content fields are text. */
  contentSchema: unknown;
  /** Content fields translated as URL path segments, such as the values record pages are found by. */
  slugs?: ReadonlySet<string>;
  /** Columns holding text, by how it's translated. */
  textColumns?: Readonly<Record<string, Format>>;
  /** Columns the job derives itself rather than merging, such as a page's full path. */
  derived?: ReadonlySet<string>;
};

/** One field of a localization: how its value is read and written, and whether it's text. */
export type Field = {
  /** The field's name in the model's requests. */
  key: string;
  /** How the field is translated, or undefined for a value copied as it is. */
  format?: Format;
  get: (values: Values) => unknown;
  set: (values: Values, value: unknown) => void;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const column = (name: string, format?: Format): Field => ({
  key: name,
  format,
  get: (values) => values[name],
  set: (values, value) => {
    if (value === undefined) delete values[name];
    else values[name] = value;
  },
});

/** A key of an object column, such as content or settings. */
const entry = (name: string, key: string, requestKey: string, format?: Format): Field => ({
  key: requestKey,
  format,
  get: (values) => (isObject(values[name]) ? values[name][key] : undefined),
  set: (values, value) => {
    const object = { ...(isObject(values[name]) ? values[name] : {}) };
    if (value === undefined) delete object[key];
    else object[key] = value;
    values[name] = object;
  },
});

/** A link's target: everything but its label, which is a field of its own. */
const linkTarget = (key: string): Field => {
  const field = entry("content", key, `${key}/target`);
  return {
    ...field,
    get: (values) => {
      const link = field.get(values);
      if (!isObject(link)) return link;
      const { text: _label, ...target } = link;
      return target;
    },
    set: (values, value) => {
      const link = field.get(values);
      const label = isObject(link) ? link.text : undefined;
      field.set(values, isObject(value) && label !== undefined ? { ...value, text: label } : value);
    },
  };
};

const linkLabel = (key: string): Field => {
  const field = entry("content", key, `${key}/text`, "plain");
  return {
    ...field,
    get: (values) => {
      const link = field.get(values);
      return isObject(link) ? link.text : undefined;
    },
    set: (values, value) => {
      const link = field.get(values);
      if (!isObject(link)) return;
      const updated = { ...link };
      if (value === undefined) delete updated.text;
      else updated.text = value;
      field.set(values, updated);
    },
  };
};

/** Every field of a localization that any of `rows` holds. */
export function fieldsFor(shape: Shape, rows: readonly Values[]): Field[] {
  const kinds = new Map(fieldsOf(shape.contentSchema).map((field) => [field.name, field.kind]));
  const keysOf = (name: string) =>
    new Set(rows.flatMap((row) => (isObject(row[name]) ? Object.keys(row[name]) : [])));
  const fields: Field[] = [];
  for (const name of new Set(rows.flatMap((row) => Object.keys(row)))) {
    if (shape.derived?.has(name)) continue;
    if (name === "settings") {
      for (const key of keysOf(name)) fields.push(entry(name, key, `settings/${key}`));
    } else if (name === "content") {
      for (const key of keysOf(name)) {
        const kind = kinds.get(key);
        if (kind === "Link") fields.push(linkTarget(key), linkLabel(key));
        else if (kind === "String")
          fields.push(entry(name, key, key, shape.slugs?.has(key) ? "slug" : "plain"));
        else if (kind === "Artifact") fields.push(entry(name, key, key, "html"));
        else fields.push(entry(name, key, key));
      }
    } else {
      fields.push(column(name, shape.textColumns?.[name]));
    }
  }
  return fields;
}

type LexicalNode = { type?: unknown; text?: unknown; children?: unknown };
type LexicalTree = { root: LexicalNode };

/** The text nodes of a Lexical tree, in document order. */
function textNodesOf(node: LexicalNode, into: LexicalNode[] = []): LexicalNode[] {
  if (node.type === "text" && typeof node.text === "string") into.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child && typeof child === "object") textNodesOf(child as LexicalNode, into);
    }
  }
  return into;
}

/**
 * A text field's value as texts for the model: one plain, HTML or slug text, or each text node
 * of rich text, keyed under the field's key.
 */
export type FieldTexts = {
  texts: TranslationText[];
  /** The value with each text replaced by its answer, or kept where none came back. */
  rebuild: (answers: Record<string, string>) => unknown;
  /** The value's rich text tree with its texts blanked, to tell if two trees line up. */
  structure?: string;
  /** Rich text's tree, read from its stored form. */
  tree?: LexicalTree;
};

/** The texts of a text field's value, or undefined when it holds no text to translate. */
export function textsOf(field: Field, value: unknown): FieldTexts | undefined {
  const { key, format } = field;
  if (format === undefined) return undefined;
  if (format === "plain" && isLexicalState(value)) {
    const tree = (
      typeof value === "string" ? JSON.parse(value) : structuredClone(value)
    ) as LexicalTree;
    const texts: TranslationText[] = [];
    textNodesOf(tree.root).forEach((node, index) => {
      const text = node.text as string;
      if (text.trim() !== "") texts.push({ key: `${key}/${index}`, text, format: "plain" });
    });
    if (texts.length === 0) return undefined;
    const blank = structuredClone(tree);
    for (const node of textNodesOf(blank.root)) node.text = "";
    return {
      texts,
      tree,
      structure: JSON.stringify(blank),
      rebuild: (answers) => {
        const copy = structuredClone(tree);
        textNodesOf(copy.root).forEach((node, index) => {
          const answer = answers[`${key}/${index}`];
          if (answer !== undefined) node.text = answer;
        });
        return typeof value === "string" ? JSON.stringify(copy) : copy;
      },
    };
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return {
    texts: [{ key, text: value, format }],
    rebuild: (answers) =>
      format === "slug" ? slugOf(answers[key], value) : (answers[key] ?? value),
  };
}

/** A translated path segment as a URL can hold it, or the source's when none is left. */
export function slugOf(translation: string | undefined, source: string) {
  const slug = translation === undefined ? "" : slugify(translation, { lower: true, strict: true });
  return slug || source;
}
