import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The color schemes defined in src/styles.css, as options for a block's "Color scheme" setting. */
export const colorSchemeOptions = {
  light: "Light",
  dark: "Dark",
  brand: "Brand",
  tint: "Tint",
} as const;

export type ColorScheme = keyof typeof colorSchemeOptions;

type SectionProps = ComponentProps<"section"> & {
  /** The block's color scheme. Everything inside follows it. */
  scheme: ColorScheme;
  /** The landmark element to render, for blocks that are a page's navbar or footer. */
  as?: "section" | "header" | "nav" | "footer";
};

/**
 * The root of every block. Use it once per block, around everything the block renders: it
 * applies the block's color scheme, its background and its vertical spacing. Override the
 * spacing with `className` (`py-0`).
 */
export function Section({ scheme, as: Element = "section", className, ...props }: SectionProps) {
  return <Element className={cn(scheme, "bg-canvas text-ink py-section", className)} {...props} />;
}
