import { lexicalTextToMarkdown, FORMAT_FLAGS } from "./modifierFormats";

export function isLexicalState(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    return parsed?.root?.type === "root";
  } catch {
    return false;
  }
}

export function plainTextToLexicalState(text: string): string {
  return JSON.stringify({
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
  });
}

export function lexicalStateToPlainText(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized);
    return extractText(parsed.root);
  } catch {
    return serialized;
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

  if (node.type === "paragraph" || node.type === "heading") {
    return parts.join("");
  }

  return parts.join("\n\n");
}

export function lexicalStateToMarkdown(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized);
    return extractMarkdown(parsed.root);
  } catch {
    return serialized;
  }
}

function extractMarkdownFromNode(node: any): string {
  if (node.type === "text") {
    return lexicalTextToMarkdown(node.text ?? "", node.format ?? 0);
  }
  if (node.type === "linebreak") return "\n";
  if (!node.children) return "";

  const parts: string[] = [];
  for (const child of node.children) {
    parts.push(extractMarkdownFromNode(child));
  }
  return parts.join("");
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
export function markdownToLexicalState(markdown: string): string {
  const paragraphs = markdown.split(/\n\n+/);
  const children = paragraphs.map((para) => ({
    children: parseInlineMarkdown(para),
    direction: "ltr" as const,
    format: "" as const,
    indent: 0,
    type: "paragraph" as const,
    version: 1,
    textFormat: 0,
    textStyle: "",
  }));

  return JSON.stringify({
    root: {
      children,
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
}

interface TextSegment {
  text: string;
  format: number;
}

function parseInlineMarkdown(text: string): any[] {
  const segments: TextSegment[] = [];
  // Match **bold**, *italic*, and ***bold+italic***
  const regex = /(\*{1,3})((?:(?!\1).)+)\1/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add any plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), format: 0 });
    }

    const stars = match[1].length;
    let format = 0;
    if (stars === 1) format = FORMAT_FLAGS.italic;
    else if (stars === 2) format = FORMAT_FLAGS.bold;
    else if (stars === 3) format = FORMAT_FLAGS.bold | FORMAT_FLAGS.italic;

    segments.push({ text: match[2], format });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), format: 0 });
  }

  // If no segments, use the whole text
  if (segments.length === 0) {
    segments.push({ text, format: 0 });
  }

  return segments.map((seg) => ({
    detail: 0,
    format: seg.format,
    mode: "normal",
    style: "",
    text: seg.text,
    type: "text",
    version: 1,
  }));
}
