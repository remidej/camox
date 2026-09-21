import * as React from "react";

import { isLexicalState, markdownToLexicalState } from "./lexicalState";
import { FORMAT_FLAGS } from "./modifierFormats";
import {
  getPageIdFromTextLinkTarget,
  isHttpTextLinkTarget,
  resolveTextLinkHref,
  shouldOpenTextLinkInNewTab,
} from "./textLinks";
import { getHighlightStyle, getTextAppearance, type InlineTextStyles } from "./textStyles";

export type { InlineStyle, InlineTextStyles, TextStyleData, TextLinkStyleData } from "./textStyles";

export interface MarkdownToReactNodesOptions extends InlineTextStyles {
  pages?: Array<{ id: number; fullPath: string }>;
  fallbackHref?: string;
}

export function markdownToReactNodes(
  value: unknown,
  options: MarkdownToReactNodesOptions = {},
): React.ReactNode {
  if (!value) return null;
  if (typeof value !== "string" && !isLexicalState(value)) return null;
  const state = isLexicalState(value)
    ? typeof value === "string"
      ? JSON.parse(value)
      : value
    : markdownToLexicalState(value as string);

  function render(node: any, key: number): React.ReactNode {
    if (node.type === "text") {
      const format = node.format ?? 0;
      let tag = "span";
      if (format & FORMAT_FLAGS.bold) tag = "strong";
      else if (format & FORMAT_FLAGS.italic) tag = "em";
      return React.createElement(tag, { key, ...getTextAppearance(format, options) }, node.text);
    }
    if (node.type === "linebreak") return <br key={key} />;
    const children = (node.children ?? []).map(render);
    if (node.type === "highlight") {
      return (
        <span key={key} data-camox-highlight="" {...getHighlightStyle(options)}>
          {children}
        </span>
      );
    }
    if (node.type === "link") {
      const href = resolveTextLinkHref(node.url, options.pages, options.fallbackHref ?? "#");
      if (!href) return <React.Fragment key={key}>{children}</React.Fragment>;
      const appearance = options.linkStyle?.({
        target: node.url,
        href,
        external: isHttpTextLinkTarget(node.url),
        pageId: getPageIdFromTextLinkTarget(node.url) ?? undefined,
      });
      const newTab = shouldOpenTextLinkInNewTab(node.url);
      return (
        <a
          key={key}
          href={href}
          target={newTab ? "_blank" : undefined}
          rel={newTab ? "noreferrer" : undefined}
          className={appearance?.className}
          style={{ textDecorationLine: "underline", ...appearance?.style }}
        >
          {children}
        </a>
      );
    }
    return <React.Fragment key={key}>{children}</React.Fragment>;
  }
  return (
    <>
      {(state as any).root.children.map((node: any, index: number) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <>
              <br />
              <br />
            </>
          )}
          {render(node, index)}
        </React.Fragment>
      ))}
    </>
  );
}
