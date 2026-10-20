import { Lexer, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";

import { isHttpTextLinkTarget, isInternalTextLinkTarget } from "@/core/lib/textLinks";

/**
 * The agent's Markdown, rendered as React elements from `marked`'s tokens. Nothing is ever set as
 * HTML: raw HTML in the Markdown shows as text, and only web and root-relative links are links.
 */
export function ThreadMarkdown({ text }: { text: string }) {
  return <div className="flex flex-col gap-2 leading-relaxed">{blocks(Lexer.lex(text))}</div>;
}

const blocks = (tokens: Token[]): ReactNode[] => tokens.map((token, index) => block(token, index));

function block(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
    case "heading":
      return (
        <p key={key} className="font-semibold">
          {inline((token as Tokens.Heading).tokens)}
        </p>
      );
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={index}>{item.tokens.flatMap((child, i) => listItemPart(child, i))}</li>
      ));
      return list.ordered ? (
        <ol key={key} className="list-decimal pl-5" start={list.start || undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc pl-5">
          {items}
        </ul>
      );
    }
    case "code":
      return (
        <pre key={key} className="bg-muted overflow-x-auto rounded-md p-2 text-xs">
          <code>{(token as Tokens.Code).text}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="text-muted-foreground border-l-2 pl-3">
          {blocks((token as Tokens.Blockquote).tokens)}
        </blockquote>
      );
    case "hr":
      return <hr key={key} />;
    case "text": {
      const text = token as Tokens.Text;
      return <p key={key}>{text.tokens ? inline(text.tokens) : text.text}</p>;
    }
    default:
      // Tables, raw HTML and anything else show as the text that was written.
      return <p key={key}>{token.raw.trim()}</p>;
  }
}

/** A list item's tight text stays inline; anything else is a block. */
function listItemPart(token: Token, key: number): ReactNode {
  if (token.type === "text") {
    const text = token as Tokens.Text;
    return <span key={key}>{text.tokens ? inline(text.tokens) : text.text}</span>;
  }
  return block(token, key);
}

const inline = (tokens: Token[] = []): ReactNode[] =>
  tokens.map((token, key) => inlineToken(token, key));

function inlineToken(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "strong":
      return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return (
        <code key={key} className="bg-muted rounded px-1 text-xs">
          {(token as Tokens.Codespan).text}
        </code>
      );
    case "br":
      return <br key={key} />;
    case "link": {
      const link = token as Tokens.Link;
      if (isHttpTextLinkTarget(link.href)) {
        return (
          <a key={key} href={link.href} target="_blank" rel="noreferrer" className="underline">
            {inline(link.tokens)}
          </a>
        );
      }
      if (isInternalTextLinkTarget(link.href)) {
        return (
          <a key={key} href={link.href} className="underline">
            {inline(link.tokens)}
          </a>
        );
      }
      return <span key={key}>{inline(link.tokens)}</span>;
    }
    case "text":
    case "escape": {
      const text = token as Tokens.Text;
      return text.tokens ? <span key={key}>{inline(text.tokens)}</span> : text.text;
    }
    default:
      return token.raw;
  }
}
