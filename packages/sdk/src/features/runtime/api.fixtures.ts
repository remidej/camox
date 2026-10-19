/** A Markdown Representation without its front matter. */
export function markdownBody(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

/** The API's answer to `pages.listBySlug`: the project's name and its pages. */
export function pageListResponse(pages: readonly unknown[] = [], projectName = "Test project") {
  return Response.json({ json: { projectName, pages } });
}
