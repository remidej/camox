/** A Markdown file, imported as its text: wrangler.jsonc bundles them with a `Text` rule. */
declare module "*.md" {
  const text: string;
  export default text;
}
