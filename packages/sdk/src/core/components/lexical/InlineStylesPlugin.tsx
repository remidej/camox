import { $isLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode } from "lexical";
import * as React from "react";

import type { MarkdownToReactNodesOptions } from "../../lib/lexicalReact";
import {
  getPageIdFromTextLinkTarget,
  isHttpTextLinkTarget,
  resolveTextLinkHref,
  shouldOpenTextLinkInNewTab,
} from "../../lib/textLinks";
import { getHighlightStyle, getTextAppearance, type InlineStyle } from "../../lib/textStyles";
import { HighlightNode, $normalizeHighlight } from "./HighlightNode";

const unitless = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexPositive",
  "flexShrink",
  "flexNegative",
  "flexOrder",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnStart",
  "gridColumnSpan",
  "gridRow",
  "gridRowEnd",
  "gridRowStart",
  "gridRowSpan",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "floodOpacity",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
]);

/** Only manages appearance attributes; Lexical retains ownership of the editable tree. */
export function InlineStylesPlugin(options: MarkdownToReactNodesOptions) {
  const [editor] = useLexicalComposerContext();
  React.useLayoutEffect(() => {
    const previous = new Map<HTMLElement, { classes: string[]; properties: string[] }>();
    function apply(dom: HTMLElement, appearance: InlineStyle) {
      const old = previous.get(dom);
      old?.classes.forEach((name) => dom.classList.remove(name));
      old?.properties.forEach((name) => dom.style.removeProperty(name));
      const classes = appearance.className?.split(/\s+/).filter(Boolean) ?? [];
      classes.forEach((name) => dom.classList.add(name));
      const properties: string[] = [];
      for (const [key, value] of Object.entries(appearance.style ?? {})) {
        if (value == null) continue;
        const property = key.startsWith("--")
          ? key
          : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^ms-/, "-ms-");
        const unprefixedKey = key.replace(
          /^(Webkit|Moz|ms|O)([A-Z])/,
          (_, _prefix, letter: string) => letter.toLowerCase(),
        );
        const cssValue =
          typeof value === "number" &&
          value !== 0 &&
          !unitless.has(unprefixedKey) &&
          !key.startsWith("--")
            ? `${value}px`
            : String(value);
        dom.style.setProperty(property, cssValue);
        properties.push(property);
      }
      previous.set(dom, { classes, properties });
    }
    function sync() {
      editor.getEditorState().read(() => {
        function visit(node: LexicalNode) {
          const dom = editor.getElementByKey(node.getKey());
          if (dom && $isTextNode(node)) apply(dom, getTextAppearance(node.getFormat(), options));
          if (dom && node instanceof HighlightNode) apply(dom, getHighlightStyle(options));
          if (dom && $isLinkNode(node)) {
            const target = node.getURL();
            const href =
              resolveTextLinkHref(target, options.pages, options.fallbackHref ?? "#") ?? "#";
            const appearance = options.linkStyle?.({
              target,
              href,
              external: isHttpTextLinkTarget(target),
              pageId: getPageIdFromTextLinkTarget(target) ?? undefined,
            });
            apply(dom, {
              className: appearance?.className,
              style: { textDecorationLine: "underline", ...appearance?.style },
            });
            dom.setAttribute("href", href);
            dom.dataset.camoxLinkTarget = target;
            if (shouldOpenTextLinkInNewTab(target)) {
              dom.setAttribute("target", "_blank");
              dom.setAttribute("rel", "noreferrer");
            } else {
              dom.removeAttribute("target");
              dom.removeAttribute("rel");
            }
          }
          if ($isElementNode(node)) node.getChildren().forEach(visit);
        }
        visit($getRoot());
      });
      for (const dom of previous.keys())
        if (!editor.getRootElement()?.contains(dom)) previous.delete(dom);
    }
    const unregister = editor.registerUpdateListener(sync);
    const unregisterRoot = editor.registerRootListener(sync);
    sync();
    return () => {
      unregister();
      unregisterRoot();
      for (const [dom, old] of previous) {
        old.classes.forEach((name) => dom.classList.remove(name));
        old.properties.forEach((name) => dom.style.removeProperty(name));
      }
    };
  }, [editor, options.textStyle, options.linkStyle, options.pages, options.fallbackHref]);

  React.useEffect(() => editor.registerNodeTransform(HighlightNode, $normalizeHighlight), [editor]);
  return null;
}
