import type { CSSProperties } from "react";

import { FORMAT_FLAGS } from "./modifierFormats";

export interface InlineStyle {
  className?: string;
  style?: CSSProperties;
}

export interface TextStyleData {
  /** True when styling the shared highlight wrapper. Other flags are false for this call. */
  highlight: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface TextLinkStyleData {
  target: string;
  href: string;
  external: boolean;
  pageId?: string;
}

/** Appearance only: Camox owns inline elements in both rendering modes. */
export interface InlineTextStyles {
  textStyle?: (format: TextStyleData) => InlineStyle | undefined;
  linkStyle?: (link: TextLinkStyleData) => InlineStyle | undefined;
}

export function getTextStyleData(format: number): TextStyleData {
  return {
    highlight: false,
    bold: !!(format & FORMAT_FLAGS.bold),
    italic: !!(format & FORMAT_FLAGS.italic),
    underline: !!(format & FORMAT_FLAGS.underline),
  };
}

export function getTextAppearance(format: number, styles: InlineTextStyles): InlineStyle {
  const flags = getTextStyleData(format);
  const custom = styles.textStyle?.(flags);
  return {
    className: custom?.className,
    style: {
      ...(flags.bold && flags.italic ? { fontStyle: "italic" } : {}),
      ...(flags.underline ? { textDecorationLine: "underline" } : {}),
      ...custom?.style,
    },
  };
}

export const defaultHighlightStyle: CSSProperties = {
  color: "var(--primary, currentColor)",
};

export function getHighlightStyle(styles: InlineTextStyles): InlineStyle {
  // Resolve the range independently of its children. The background must not be
  // applied to each formatted run, which would restart it at every boundary.
  const custom = styles.textStyle?.({
    highlight: true,
    bold: false,
    italic: false,
    underline: false,
  });
  return {
    className: custom?.className,
    style: { ...defaultHighlightStyle, ...custom?.style },
  };
}
