import slugify from "slugify";

import type { TranslationText } from "../../lib/ai-model";
import { isObject } from "../../lib/is-object";
import {
  isLexicalState,
  lexicalStateToMarkdown,
  markdownToLexicalState,
} from "../../lib/lexical-state";
import { fieldsOf } from "../_shared/fields";
import type { Values } from "./bookkeeping";

// The units of a localization a translation job merges one by one, read from its stored schema,
// and the texts it sends the model for each. A unit is a column, a group of columns, a key of the
// content (a field, or a link's target or label) or a key of the settings (a block setting). Text
// fields, link labels and artifact sources are translated; every other value is copied as it is,
// ids included, so references and links keep pointing at the same entities in the localization's
// locale.

type Format = TranslationText["format"];

/** What a localization holds, beyond what its stored schema says. */
export type Shape = {
  /** The stored schema of its content, which says which content fields are text. */
  contentSchema: unknown;
  /** Content fields translated as URL path segments, such as the values record pages are found by. */
  slugs?: ReadonlySet<string>;
  /** Columns holding text, by how it's translated. */
  textColumns?: Readonly<Record<string, Format>>;
  /** Columns merged as one unit, such as a page's SEO, which is all generated or all manual. */
  columnGroups?: readonly (readonly string[])[];
  /** Columns the job derives itself rather than merging, such as a page's full path. */
  derived?: ReadonlySet<string>;
};

/**
 * A text unit's value as texts for the model: one plain, HTML or slug text, each text node of
 * rich text, or the texts of each column of a group, keyed under the unit's key.
 */
export type UnitTexts = {
  texts: TranslationText[];
  /** The value with each text replaced by its answer, or kept where none came back. */
  rebuild: (answers: Record<string, string>) => unknown;
  /** The value with its texts blanked: two values' texts line up key by key when it's the same. */
  structure: string;
  /** Rich text as one Markdown text, and the value an answer in Markdown makes. */
  whole?: { text: string; rebuild: (answer: string) => unknown };
};

/** One unit of a localization a translation job merges: how its value is read and written. */
export type MergeUnit = {
  /** The unit's name in the model's requests. */
  key: string;
  get: (values: Values) => unknown;
  set: (values: Values, value: unknown) => void;
  /** The texts a value of the unit holds; absent for a value copied as it is. */
  texts?: (value: unknown) => UnitTexts | undefined;
};

const column = (name: string, format?: Format): MergeUnit => ({
  key: name,
  texts: format && textsAs(name, format),
  get: (values) => values[name],
  set: (values, value) => {
    if (value === undefined) delete values[name];
    else values[name] = value;
  },
});

/** Columns merged as one unit, their value an object by column. */
const columnGroup = (members: MergeUnit[]): MergeUnit => ({
  key: members.map((member) => member.key).join("+"),
  get: (values) => Object.fromEntries(members.map((member) => [member.key, member.get(values)])),
  set: (values, value) => {
    for (const member of members) member.set(values, isObject(value) ? value[member.key] : value);
  },
  texts: (value) => {
    if (!isObject(value)) return undefined;
    const parts = members.map((member) => ({ member, texts: textsOf(member, value[member.key]) }));
    if (parts.every(({ texts }) => !texts)) return undefined;
    return {
      texts: parts.flatMap(({ texts }) => texts?.texts ?? []),
      structure: JSON.stringify(parts.map(({ texts }) => texts?.structure ?? null)),
      rebuild: (answers) =>
        Object.fromEntries(
          parts.map(({ member, texts }) => [
            member.key,
            texts ? texts.rebuild(answers) : value[member.key],
          ]),
        ),
    };
  },
});

/** A key of an object column, such as content or settings. */
const entry = (name: string, key: string, requestKey: string, format?: Format): MergeUnit => ({
  key: requestKey,
  texts: format && textsAs(requestKey, format),
  get: (values) => (isObject(values[name]) ? values[name][key] : undefined),
  set: (values, value) => {
    const object = { ...(isObject(values[name]) ? values[name] : {}) };
    if (value === undefined) delete object[key];
    else object[key] = value;
    values[name] = object;
  },
});

/** A link with its label, `text`, apart from its target, everything else. */
const splitLink = (link: Record<string, unknown>) => {
  const { text: label, ...target } = link;
  return { label, target };
};

const joinLink = (target: Record<string, unknown>, label: unknown) =>
  label === undefined ? { ...target } : { ...target, text: label };

/** One part of a link field, merged on its own: its target, or its translated label. */
const linkPart = (key: string, part: "target" | "label"): MergeUnit => {
  const link = entry("content", key, key);
  const label = part === "label";
  const requestKey = `${key}/${label ? "text" : "target"}`;
  return {
    key: requestKey,
    texts: label ? textsAs(requestKey, "plain") : undefined,
    get: (values) => {
      const held = link.get(values);
      if (!isObject(held)) return label ? undefined : held;
      const parts = splitLink(held);
      return label ? parts.label : parts.target;
    },
    set: (values, value) => {
      const held = link.get(values);
      const parts = isObject(held) ? splitLink(held) : undefined;
      if (label) {
        if (parts) link.set(values, joinLink(parts.target, value));
      } else {
        link.set(values, isObject(value) ? joinLink(value, parts?.label) : value);
      }
    },
  };
};

/** Every unit of a localization that any of `rows` holds. */
export function mergeUnitsOf(shape: Shape, rows: readonly Values[]): MergeUnit[] {
  const kinds = new Map(fieldsOf(shape.contentSchema).map((field) => [field.name, field.kind]));
  const keysOf = (name: string) =>
    new Set(rows.flatMap((row) => (isObject(row[name]) ? Object.keys(row[name]) : [])));
  const columnOf = (name: string) => column(name, shape.textColumns?.[name]);
  const units: MergeUnit[] = [];
  const grouped = new Set<string>();
  for (const name of new Set(rows.flatMap((row) => Object.keys(row)))) {
    if (shape.derived?.has(name) || grouped.has(name)) continue;
    const group = shape.columnGroups?.find((columns) => columns.includes(name));
    if (group) {
      for (const member of group) grouped.add(member);
      units.push(columnGroup(group.map(columnOf)));
    } else if (name === "settings") {
      for (const key of keysOf(name)) units.push(entry(name, key, `settings/${key}`));
    } else if (name === "content") {
      for (const key of keysOf(name)) {
        const kind = kinds.get(key);
        if (kind === "Link") units.push(linkPart(key, "target"), linkPart(key, "label"));
        else if (kind === "String")
          units.push(entry(name, key, key, shape.slugs?.has(key) ? "slug" : "plain"));
        else if (kind === "Artifact") units.push(entry(name, key, key, "html"));
        else units.push(entry(name, key, key));
      }
    } else {
      units.push(columnOf(name));
    }
  }
  return units;
}

/** The texts of a unit's value, or undefined when it holds no text to translate. */
export const textsOf = (unit: MergeUnit, value: unknown) => unit.texts?.(value);

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

/** How a text value under `key` is read as texts for the model. */
const textsAs =
  (key: string, format: Format) =>
  (value: unknown): UnitTexts | undefined => {
    if (format === "plain" && isLexicalState(value)) return richTextsOf(key, value);
    if (typeof value !== "string" || value.trim() === "") return undefined;
    return {
      texts: [{ key, text: value, format }],
      structure: "",
      rebuild: (answers) =>
        format === "slug" ? slugOf(answers[key], value) : (answers[key] ?? value),
    };
  };

/** Rich text's texts: each of its text nodes, keyed by its place in the tree. */
function richTextsOf(key: string, value: unknown): UnitTexts | undefined {
  const tree = (
    typeof value === "string" ? JSON.parse(value) : structuredClone(value)
  ) as LexicalTree;
  // Rich text is stored as the Lexical state, or as its JSON.
  const stored = (state: unknown) => (typeof value === "string" ? JSON.stringify(state) : state);
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
    structure: JSON.stringify(blank),
    rebuild: (answers) => {
      const copy = structuredClone(tree);
      textNodesOf(copy.root).forEach((node, index) => {
        const answer = answers[`${key}/${index}`];
        if (answer !== undefined) node.text = answer;
      });
      return stored(copy);
    },
    whole: {
      text: lexicalStateToMarkdown(tree),
      rebuild: (answer) => stored(markdownToLexicalState(answer)),
    },
  };
}

/** A translated path segment as a URL can hold it, or the source's when none is left. */
export function slugOf(translation: string | undefined, source: string) {
  const slug = translation === undefined ? "" : slugify(translation, { lower: true, strict: true });
  return slug || source;
}

/**
 * The texts of content its schema calls text, and the content with each replaced by its answer,
 * as a defaults translation sends them: every merge unit of the content that holds text.
 */
export function contentTexts(schema: unknown, content: Record<string, unknown>) {
  const values: Values = { content };
  const found = mergeUnitsOf({ contentSchema: schema }, [values]).flatMap((unit) => {
    const texts = textsOf(unit, unit.get(values));
    return texts ? [{ unit, texts }] : [];
  });
  return {
    texts: found.flatMap(({ texts }) => texts.texts),
    translated: (answers: Record<string, string>) => {
      const into: Values = { content: { ...content } };
      for (const { unit, texts } of found) unit.set(into, texts.rebuild(answers));
      return into.content as Record<string, unknown>;
    },
  };
}
