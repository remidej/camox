import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

/** Shared focus-ring + validation styles for all input-like elements (Input, Textarea, ContentEditable, etc.) */
export const INPUT_FOCUS_STYLES =
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive";

/** Shared base styles for input-like elements (border, text, shadow, transition, outline) */
export const INPUT_BASE_STYLES =
  "border-input placeholder:text-muted-foreground rounded-md border bg-transparent text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";
