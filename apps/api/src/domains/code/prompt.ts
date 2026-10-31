/**
 * The rules of a website Camox hosts, which whoever writes its code follows: SEO, fonts, imports,
 * block ids and media.
 */
export const HOSTED_SITE_RULES = `Rules of this website, which Camox hosts:
- SEO links belong to Camox, which writes each page's meta tags, \`hreflang\` alternates and \
sitemap from its content: leave them out of the code.
- A font is a Google Fonts stylesheet in the Document's \`link\` (\`src/document.ts\`) plus its \
family's name in the Theme's \`--font-*\` tokens (\`src/styles.css\`). Find the family and its exact \
link with searchFonts. Camox serves Google Fonts links from the website's own origin, so a link \
is all a font needs.
- Import only files in \`src/\`, by relative or \`@/\` paths that stay inside it; \`camox\`'s public \
entry points, the ones its \`package.json\` \`exports\` lists, such as \`camox/createBlock\`; and the \
packages \`package.json\` lists in \`dependencies\`. The build fails on any other import, whatever \
lint rules say. You can't add a dependency: build with the ones listed.
- A block's file name is its id: the block \`pricing-table\` is \`src/blocks/pricing-table.tsx\`. \
Write the id as a string literal, \`createBlock({ id: "pricing-table", … })\`: the build reads it \
there, and fails when it isn't one or doesn't match the file name.
- Images and other media are files, managed as content, never code: upload one from a URL with \
uploadFile, and use it through an image or file field.`;
