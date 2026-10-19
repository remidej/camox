/** `value`, safe inside a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** `value` as JSON that can't close the `<script>` element it's written into. */
export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
