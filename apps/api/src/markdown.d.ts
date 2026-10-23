/** A Markdown file, imported as its text (the `Text` module rule in wrangler.jsonc). */
declare module "*.md" {
  const text: string;
  export default text;
}
