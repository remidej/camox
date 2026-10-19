/** The API's answer to `pages.listBySlug`: the project's name and its pages. */
export function pageListResponse(pages: readonly unknown[] = [], projectName = "Test project") {
  return Response.json({ json: { projectName, pages } });
}

/** The API's answer to `locales.list`: the scope's locales by tag, the default locale first. */
export function localesResponse(tags: readonly string[] = ["en"]) {
  return Response.json({ json: tags.map((tag, index) => ({ tag, isDefault: index === 0 })) });
}
