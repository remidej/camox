/** The API's answer to `pages.listBySlug`: the project's name and its pages. */
export function pageListResponse(pages: readonly unknown[] = [], projectName = "Test project") {
  return Response.json({ json: { projectName, pages } });
}
