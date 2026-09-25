const FORMAT_FLAGS = {
  bold: 1,
  italic: 2,
} as const;

const MARKDOWN_WRAPPERS: Record<string, (text: string) => string> = {
  bold: (text) => `**${text}**`,
  italic: (text) => `*${text}*`,
};

const PAGE_TEXT_LINK_PREFIX = "camox:page:";

function isValidTextLinkTarget(target: string): boolean {
  return (
    target.startsWith(PAGE_TEXT_LINK_PREFIX) ||
    /^https?:\/\//i.test(target) ||
    /^\/(?!\/)[^\s\\\p{Cc}]*$/u.test(target)
  );
}

function lexicalTextToMarkdown(text: string, format: number): string {
  let result = text;
  for (const [key, wrapper] of Object.entries(MARKDOWN_WRAPPERS)) {
    const flag = FORMAT_FLAGS[key as keyof typeof FORMAT_FLAGS];
    if (flag && format & flag) {
      result = wrapper(result);
    }
  }
  return result;
}

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

  // Match the SDK: paragraph boundaries live at the root, never between
  // differently formatted text spans inside an inline link.
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
  if (node.type === "text") {
    return lexicalTextToMarkdown(node.text ?? "", node.format ?? 0);
  }
  if (node.type === "link") {
    const text = (node.children ?? []).map(extractMarkdownFromNode).join("");
    const url = typeof node.url === "string" ? node.url : "";
    if (!url) return text;
    return `[${text}](${url})`;
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

interface TextSegment {
  text: string;
  format: number;
}

function parseInlineMarkdown(text: string): any[] {
  const nodes: any[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastLinkIndex = 0;
  let linkMatch;

  while ((linkMatch = linkRegex.exec(text)) !== null) {
    if (linkMatch.index > lastLinkIndex) {
      nodes.push(...parseFormattedText(text.slice(lastLinkIndex, linkMatch.index)));
    }

    const [, label, target] = linkMatch;
    if (isValidTextLinkTarget(target)) {
      nodes.push({
        children: parseFormattedText(label),
        direction: "ltr",
        format: "",
        indent: 0,
        rel: null,
        target: null,
        title: null,
        type: "link",
        url: target,
        version: 1,
      });
    } else {
      nodes.push(...parseFormattedText(label));
    }

    lastLinkIndex = linkMatch.index + linkMatch[0].length;
  }

  if (lastLinkIndex < text.length) {
    nodes.push(...parseFormattedText(text.slice(lastLinkIndex)));
  }

  if (nodes.length === 0) return parseFormattedText(text);
  return nodes;
}

function parseFormattedText(text: string): any[] {
  const segments: TextSegment[] = [];
  const regex = /(\*{1,3})((?:(?!\1).)+)\1/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
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

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), format: 0 });
  }

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

export function markdownToLexicalState(markdown: string): Record<string, unknown> {
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
