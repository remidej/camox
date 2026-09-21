import { Lexer, type Token } from "marked";

import { FORMAT_FLAGS } from "./modifierFormats";
import { isValidTextLinkTarget } from "./textLinks";

export function isLexicalState(value: unknown): boolean {
  if (typeof value === "object" && value !== null) {
    return (value as any)?.root?.type === "root";
  }
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    return parsed?.root?.type === "root";
  } catch {
    return false;
  }
}

export function plainTextToLexicalState(text: string): Record<string, unknown> {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
          textFormat: 0,
          textStyle: "",
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

export function lexicalStateToPlainText(serialized: string | Record<string, unknown>): string {
  try {
    const parsed = typeof serialized === "object" ? serialized : JSON.parse(serialized);
    return extractText(parsed.root);
  } catch {
    return typeof serialized === "string" ? serialized : "";
  }
}

function extractText(node: any): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "linebreak") return "\n";
  if (!node.children) return "";

  const parts: string[] = [];
  for (const child of node.children) {
    parts.push(extractText(child));
  }

  if (node.type === "paragraph" || node.type === "inline-paragraph" || node.type === "heading") {
    return parts.join("");
  }

  return parts.join(node.type === "root" ? "\n\n" : "");
}

export function lexicalStateToMarkdown(serialized: string | Record<string, unknown>): string {
  try {
    const parsed = typeof serialized === "object" ? serialized : JSON.parse(serialized);
    return extractMarkdown(parsed.root);
  } catch {
    return typeof serialized === "string" ? serialized : "";
  }
}

function extractMarkdownFromNode(node: any): string {
  if (node.type === "highlight") {
    return `<highlight>${serializeInlineChildren(node.children ?? [])}</highlight>`;
  }
  if (node.type === "link") {
    const text = serializeInlineChildren(node.children ?? []);
    const url = typeof node.url === "string" ? node.url : "";
    if (!url) return text;
    return `[${text}](${url})`;
  }
  if (node.type === "linebreak") return "\n";
  if (!node.children) return "";

  return serializeInlineChildren(node.children);
}

// Keep common formatting open across adjacent runs: **bold *both***, not
// **bold*****both*** (an ambiguous sequence of delimiters).
function serializeInlineChildren(nodes: any[]): string {
  const marks = [
    { flag: FORMAT_FLAGS.underline, open: "<u>", close: "</u>" },
    { flag: FORMAT_FLAGS.bold, open: "**", close: "**" },
    { flag: FORMAT_FLAGS.italic, open: "*", close: "*" },
  ];
  let active: typeof marks = [];
  let result = "";
  function transition(next: typeof marks) {
    let common = 0;
    while (common < active.length && common < next.length && active[common] === next[common])
      common++;
    for (let i = active.length - 1; i >= common; i--) result += active[i].close;
    for (let i = common; i < next.length; i++) result += next[i].open;
    active = next;
  }
  for (const node of nodes) {
    if (node.type !== "text") {
      transition([]);
      result += extractMarkdownFromNode(node);
      continue;
    }
    transition(marks.filter(({ flag }) => (node.format ?? 0) & flag));
    result += (node.text ?? "").replace(/[\\*_[\]<>]/g, "\\$&");
  }
  transition([]);
  if (inlineSignature(parseInlineMarkdown(result)) === inlineSignature(nodes)) return result;
  // Markdown delimiters cannot express every editable range (e.g. leading spaces
  // or crossing bold/italic boundaries). Use explicit built-in tags losslessly.
  return nodes
    .map((node) => {
      if (node.type !== "text") return extractMarkdownFromNode(node);
      let text = (node.text ?? "").replace(/[\\*_[\]<>]/g, "\\$&");
      if (node.format & FORMAT_FLAGS.italic) text = `<em>${text}</em>`;
      if (node.format & FORMAT_FLAGS.bold) text = `<strong>${text}</strong>`;
      if (node.format & FORMAT_FLAGS.underline) text = `<u>${text}</u>`;
      return text;
    })
    .join("");
}

function inlineSignature(nodes: any[]): string {
  const normalized: any[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const last = normalized.at(-1);
      if (last?.type === "text" && last.format === node.format) {
        last.text += node.text;
        continue;
      }
      normalized.push({ type: "text", text: node.text, format: node.format ?? 0 });
      continue;
    }
    normalized.push({
      type: node.type,
      url: node.url,
      children: node.children ? inlineSignature(node.children) : undefined,
    });
  }
  return JSON.stringify(normalized);
}

function extractMarkdown(node: any): string {
  if (!node.children) return "";

  const paragraphs: string[] = [];
  for (const child of node.children) {
    paragraphs.push(extractMarkdownFromNode(child));
  }
  return paragraphs.join("\n\n");
}

/**
 * Parse simple markdown (bold/italic) into Lexical JSON.
 * Works without Lexical runtime — pure string parsing.
 */
export function markdownToLexicalState(markdown: string): Record<string, unknown> {
  const children = [
    {
      children: parseInlineMarkdown(markdown),
      direction: "ltr" as const,
      format: "" as const,
      indent: 0,
      type: "paragraph" as const,
      version: 1,
      textFormat: 0,
      textStyle: "",
    },
  ];

  return {
    root: {
      children,
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

function inlineElement(type: string, children: any[], extra = {}) {
  return { type, children, direction: "ltr", format: "", indent: 0, version: 1, ...extra };
}

/** Shared by the public renderer and editor. Only recognized inline syntax is interpreted. */
export function parseInlineMarkdown(text: string, format = 0): any[] {
  return parseTokens(Lexer.lexInline(text, { gfm: false }), format);
}

function parseTokens(tokens: Token[], format: number): any[] {
  const nodes: any[] = [];
  const appendText = (text: string) => {
    text.split("\n").forEach((line, index) => {
      if (index) nodes.push({ type: "linebreak", version: 1 });
      if (!line) return;
      const last = nodes.at(-1);
      if (last?.type === "text" && last.format === format) {
        last.text += line;
        return;
      }
      nodes.push({
        detail: 0,
        format,
        mode: "normal",
        style: "",
        text: line,
        type: "text",
        version: 1,
      });
    });
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "strong" || token.type === "em") {
      nodes.push(
        ...parseTokens(
          token.tokens ?? [],
          format | (token.type === "strong" ? FORMAT_FLAGS.bold : FORMAT_FLAGS.italic),
        ),
      );
      continue;
    }
    if (token.type === "link") {
      const children = parseTokens(token.tokens ?? [], format);
      if (isValidTextLinkTarget(token.href)) {
        nodes.push(
          inlineElement("link", children, {
            url: token.href,
            rel: null,
            target: null,
            title: null,
          }),
        );
      } else nodes.push(...children);
      continue;
    }
    const tag =
      token.type === "html" ? /^<(highlight|u|strong|em)>$/.exec(token.raw)?.[1] : undefined;
    if (tag) {
      let depth = 1;
      let end = i + 1;
      for (; end < tokens.length; end++) {
        if (tokens[end].type !== "html") continue;
        if (tokens[end].raw === `<${tag}>`) depth++;
        if (tokens[end].raw === `</${tag}>`) depth--;
        if (!depth) break;
      }
      if (!depth) {
        const tagFlags: Record<string, number> = {
          u: FORMAT_FLAGS.underline,
          strong: FORMAT_FLAGS.bold,
          em: FORMAT_FLAGS.italic,
        };
        const children = parseTokens(tokens.slice(i + 1, end), format | (tagFlags[tag] ?? 0));
        if (tag === "highlight") nodes.push(inlineElement("highlight", children));
        else nodes.push(...children);
        i = end;
        continue;
      }
    }
    if (token.type === "br") {
      nodes.push({ type: "linebreak", version: 1 });
      continue;
    }
    // Never render arbitrary HTML or unsupported Markdown as markup.
    appendText(token.type === "text" || token.type === "escape" ? token.text : token.raw);
  }
  return nodes;
}
