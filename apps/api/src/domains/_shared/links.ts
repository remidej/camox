import { PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";

import { isLexicalState } from "../../lib/lexical-state";
import { type Field, fieldsOf } from "./fields";

// The links content holds: a Link field's, and those in rich text (ADR 0034's Link checker). A
// link's url is as content stores it: a page link's is `camox:page:<id>`.

/** A link in a field's value: where it leads, and what it reads. */
export type ContentLink = { url: string; text: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type LexicalNode = { type?: unknown; url?: unknown; text?: unknown; children?: unknown };

const childrenOf = (node: LexicalNode): LexicalNode[] =>
  Array.isArray(node.children) ? (node.children as LexicalNode[]) : [];

const textOf = (node: LexicalNode): string =>
  typeof node.text === "string" ? node.text : childrenOf(node).map(textOf).join("");

/** Rich text's state, parsed when stored as JSON, or undefined for plain text. */
const lexicalOf = (value: unknown): { root: LexicalNode } | undefined => {
  if (!isLexicalState(value)) return undefined;
  return (typeof value === "string" ? JSON.parse(value) : value) as { root: LexicalNode };
};

/** A Link field value's url: a page link's, an external link's href, or none while unset. */
function linkFieldUrl(value: Record<string, unknown>) {
  if (value.type === "page") {
    return typeof value.pageId === "string" && value.pageId !== ""
      ? `${PAGE_TEXT_LINK_PREFIX}${value.pageId}`
      : undefined;
  }
  return typeof value.href === "string" && value.href !== "" ? value.href : undefined;
}

/** The links a field's value holds, in order: a Link field's, or rich text's. */
export function linksOf(field: Field, value: unknown): ContentLink[] {
  if (field.kind === "Link") {
    if (!isObject(value)) return [];
    const url = linkFieldUrl(value);
    return url === undefined
      ? []
      : [{ url, text: typeof value.text === "string" ? value.text : "" }];
  }
  if (field.kind !== "String") return [];
  const state = lexicalOf(value);
  if (!state) return [];
  const links: ContentLink[] = [];
  const walk = (node: LexicalNode) => {
    if (node.type === "link" && typeof node.url === "string") {
      links.push({ url: node.url, text: textOf(node) });
    }
    childrenOf(node).forEach(walk);
  };
  walk(state.root);
  return links;
}

/** The links content holds, field by field in schema order. */
export function linksIn(schema: unknown, content: unknown): { field: Field; link: ContentLink }[] {
  if (!isObject(content)) return [];
  return fieldsOf(schema).flatMap((field) =>
    linksOf(field, content[field.name]).map((link) => ({ field, link })),
  );
}

/**
 * A field's value without its links to `url`, keeping what they read: a Link field becomes an
 * external link to nowhere, and rich text keeps each link's text, formatting included, in its
 * place. Undefined when the value holds no link to `url`.
 */
export function withoutLink(field: Field, value: unknown, url: string): unknown {
  if (!linksOf(field, value).some((link) => link.url === url)) return undefined;
  if (field.kind === "Link") {
    const { pageId: _, ...rest } = value as Record<string, unknown>;
    return { ...rest, type: "external", href: "" };
  }
  const state = lexicalOf(value)!;
  const unwrap = (node: LexicalNode): LexicalNode[] => {
    if (node.type === "link" && node.url === url) return childrenOf(node).flatMap(unwrap);
    if (!Array.isArray(node.children)) return [node];
    return [{ ...node, children: childrenOf(node).flatMap(unwrap) }];
  };
  const root = { ...state, root: unwrap(state.root)[0] };
  return typeof value === "string" ? JSON.stringify(root) : root;
}
