export { cn, INPUT_BASE_STYLES, INPUT_FOCUS_STYLES } from "@camox/ui/utils";

export function checkIfInputFocused(document: Document = window.document) {
  return (
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "TEXTAREA" ||
    (document.activeElement?.getAttribute("contenteditable") ?? "false") === "true"
  );
}

/**
 * Converts a URL path segment into a human-readable title.
 * Replaces dashes and underscores with spaces and capitalizes each word.
 *
 * @example formatPathSegment("about-us") // "About Us"
 * @example formatPathSegment("studio_ui") // "Studio Ui"
 */
export function formatPathSegment(segment: string): string {
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
