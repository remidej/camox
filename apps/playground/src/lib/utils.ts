import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teaches tailwind-merge the Theme's token names (see src/styles.css), so it knows that
// `text-title` is a size and `text-ink` a color, and merges each against its own kind.
// Add a name here when adding a token to the Theme.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "canvas",
        "panel",
        "ink",
        "ink-muted",
        "line",
        "brand",
        "ink-on-brand",
        "success",
        "warning",
        "error",
      ],
      text: ["display", "heading", "title", "lead", "eyebrow"],
      font: ["heading", "body"],
      radius: ["control", "card"],
      container: ["page", "text"],
      spacing: ["gutter", "section", "navbar"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
