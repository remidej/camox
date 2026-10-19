import slugify from "slugify";

import type { TranslationText, Translations } from "../../lib/ai-model";
import { isLexicalState } from "../../lib/lexical-state";
import { fieldsOf } from "../_shared/fields";

// What a translation job sends the model, read from content by its stored schema, and how its
// translations are put back (ADR 0015). Text fields, link labels and artifact sources are
// translated; every other value is copied as it is, ids included, so references and links keep
// pointing at the same entities in the localization's locale.

type Content = Record<string, unknown>;

/** Texts to translate, and the content with their translations in place. */
export type TextsOf<T> = {
  texts: TranslationText[];
  /** The source with each text replaced by its translation, or kept where none came back. */
  translated: (translations: Translations) => T;
};

type LexicalNode = { type?: unknown; text?: unknown; children?: unknown };

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
 * The texts of content its schema calls text, keyed by field: plain strings and each text node of
 * rich text, the labels of links, and artifact sources. Repeatable items hold their own content.
 * Plain string fields named in `slugs`, such as the values record pages are found by, are
 * translated as URL path segments.
 */
export function contentTexts(
  schema: unknown,
  content: Content,
  slugs: ReadonlySet<string> = new Set(),
): TextsOf<Content> {
  const texts: TranslationText[] = [];
  const puts: ((translations: Translations, into: Content) => void)[] = [];
  const add = (key: string, text: string, format: TranslationText["format"]) => {
    if (text.trim() === "") return false;
    texts.push({ key, text, format });
    return true;
  };

  for (const field of fieldsOf(schema)) {
    const { name } = field;
    const value = content[name];
    if (field.kind === "String" && isLexicalState(value)) {
      const keys: string[] = [];
      const tree = (typeof value === "string" ? JSON.parse(value) : value) as {
        root: LexicalNode;
      };
      textNodesOf(tree.root).forEach((node, index) => {
        const key = `${name}/${index}`;
        if (add(key, node.text as string, "plain")) keys.push(key);
      });
      if (keys.length === 0) continue;
      puts.push((translations, into) => {
        const copy = structuredClone(tree);
        const nodes = textNodesOf(copy.root);
        nodes.forEach((node, index) => {
          const translation = translations[`${name}/${index}`];
          if (translation !== undefined) node.text = translation;
        });
        into[name] = typeof value === "string" ? JSON.stringify(copy) : copy;
      });
    } else if (field.kind === "String" && slugs.has(name) && typeof value === "string") {
      if (!add(name, value, "slug")) continue;
      puts.push((translations, into) => {
        into[name] = slugOf(translations[name], value);
      });
    } else if (
      (field.kind === "String" || field.kind === "Artifact") &&
      typeof value === "string"
    ) {
      if (!add(name, value, field.kind === "Artifact" ? "html" : "plain")) continue;
      puts.push((translations, into) => {
        into[name] = translations[name] ?? value;
      });
    } else if (field.kind === "Link" && isObject(value) && typeof value.text === "string") {
      const key = `${name}/text`;
      if (!add(key, value.text, "plain")) continue;
      puts.push((translations, into) => {
        into[name] = { ...value, text: translations[key] ?? value.text };
      });
    }
  }

  return {
    texts,
    translated: (translations) => {
      const into = structuredClone(content);
      for (const put of puts) put(translations, into);
      return into;
    },
  };
}

/** A translated path segment as a URL can hold it, or the source's when none is left. */
export function slugOf(translation: string | undefined, source: string) {
  const slug = translation === undefined ? "" : slugify(translation, { lower: true, strict: true });
  return slug || source;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
