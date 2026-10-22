import type { SettingBuilder } from "camox/createBlock";
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

/**
 * A block's "Color scheme" setting, offering every scheme in src/styles.css. Read it with
 * `useSetting("scheme")` and pass it to `Section`.
 *
 * @example
 * settings: (setting) => ({ scheme: colorSchemeSetting(setting, "dark") })
 */
export function colorSchemeSetting(setting: SettingBuilder, defaultScheme: ColorScheme) {
  return setting.enum({
    default: defaultScheme,
    options: colorSchemeOptions,
    title: "Color scheme",
  });
}

type SectionProps = ComponentProps<"section"> & {
  /** The block's "Color scheme" setting. Everything inside follows it. */
  scheme: ColorScheme;
  /** The landmark element to render, for blocks that are a page's navbar or footer. */
  as?: "section" | "header" | "nav" | "footer";
};

/**
 * The root of every block. Use it once per block, around everything the block renders: it
 * applies the block's color scheme, its background and its vertical spacing. Pass the
 * block's `scheme` setting through. Override the spacing with `className` (`py-6`).
 */
export function Section({ scheme, as: Element = "section", className, ...props }: SectionProps) {
  return <Element className={cn(scheme, "bg-canvas text-ink py-section", className)} {...props} />;
}
